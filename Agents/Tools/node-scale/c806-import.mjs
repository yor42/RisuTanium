// CHORE-806 stage 4 and CHORE-807 stage 1: peak memory of a synthetic .bin import through the real page (the page import of the Welcome screen's restore), on a ladder of sizes.
//
//   node c806-import.mjs run [--rungs 0.5,1,2,4] [--characters 1000] [--chats 20] [--modules 180] [--archive on|off] [--cap-min 60]
//                            [--stage1-census <census.json>] [--no-census] [--keep-bin] [--keep-tree] [--out <folder under the scratch root>]
//                            [--slot a|b|any] [--slot-text <owner text>] [--host-free-floor-gib 8] [--confirm-failure] [--preflight <preflight.json>]
//   node c806-import.mjs gen-preflight [--rungs 16,12,10] [--characters ..] [--chats ..] [--modules ..] [--archive ..] [--slot ..] [--out <folder>]
//   node c806-import.mjs selfcheck [--only <id,id>] [--extra-fault <mutant>] [--out <folder>]
//        (the stage 4 and stage 1 self-checks, each a tiny ladder in a child process; prints which checks failed)
//
// A rung is one message median (the library's `messagesPerChat`). The ladder climbs through --rungs in order and stops at the first
// rung whose class ends it (a verdict is recorded); the base rung is the median 0.5 that matches the real library size (MC-1966,
// stage 0 sweep); 1, 2, 4 climb above it, and 6 to 16 can be added with --rungs.
// Stop classes (c807-pageend.mjs classifyStop, in precedence order): renderer-crash, host-floor, page-error / page-unconfirmed /
// page-blocked / page-refused, page-other, cap-alive / cap-unresponsive, page-mismatch, census-unverified, tool, ok / unverified.
// Breaking: renderer-crash, page-error, page-unconfirmed, page-blocked, page-refused, page-mismatch. page-other is never a breaking
// point: a human reads atFailure.alertText first. A failed rung carries no peak figure and an atFailure record instead.
// Rung status: ok only when the census harness exited 0 and the imported tree's census equals the .bin's parameters
// (census.againstParams.equal); unverified when --no-census skipped it or the census failed as a tool even after one retry
// (class census-unverified; the figures are then unchecked and labelled so); failed otherwise, with no figure in rung.json,
// ladder.json or the console line.
// Heap figures: phaseRingPeakHeapMiB (the page's own import phase ring, __risuImportPhases) is the headline heap figure;
// cdpHeapPeakBetweenBlocksMiB is the highest CDP sample and misses a peak inside a blocked stretch (see the block report).
// Invariants:
// - Each rung starts from a freshly generated .bin, an empty server data dir (no login files), a fresh Chrome profile, and one
//   measurement-flag state: risu-measure-import on, risu-measure-savepass off, both set by a script added before any page script.
// - The flow is the real first move of an upstream user: sign in on the empty profile, then the restore button of the first screen
//   (the Welcome screen's "Restore a backup", which runs the page import commitStore2Import and reloads onto the installed profile;
//   the first-life boot import, which has its own offer button, is not driven), whose file picker is
//   intercepted and answered with the generated .bin (c806-page importBinThroughPage). Only a .bin with a matching c806 sidecar
//   is accepted, so no real backup can reach the page. The Settings-import arm is not run.
// - After the file is handed over, every 700 ms one probe reads the alert boxes and the boot screen (c807-pageend.mjs). Only a
//   whitelisted size, time or space warning ("Continue?") is answered; a progress wait passes; anything else ends the rung at once and
//   is labelled from its recorded text. The page import leaves a refusal (decode failure, read-failed, repair-refused, unsavable, a
//   failed or abandoned commit) on screen as an error box, so it lands as page-error; an unknown outcome lands as page-unconfirmed.
//   After a landed install the reload boots the installed profile: a tree that cannot be read stops on the boot "blocked" screen
//   (page-blocked). A skipped-assets notice after a landed install may end a rung as page-other; that is a notice, not a failure,
//   and a human reads it.
// - The page's language follows the browser's and is recorded in rung.pageLanguage, not pinned (importBinThroughPage answers the
//   restore confirmation with a case-sensitive Yes that the English "YES" label does not match); the page-end table matches the
//   app's English and Korean strings, and another browser language ends a rung as page-other.
// - Every 250 ms the page's JS heap is read over CDP (Runtime.getHeapUsage). A gap between two samples above 1000 ms means the
//   main thread was blocked, and is kept and reported as such. In parallel c806-proc-sampler.ps1 reads private bytes and
//   working set of every Chrome process and of the server from the OS; the PID list comes from SystemInfo.getProcessInfo on the
//   browser target, refreshed every second. The OS sampler covers a synchronous decode in which the CDP samples stall.
// - "File to home" runs from the moment the file was handed to the picker (DOM.setFileInputFiles) to the home screen.
// - A full-run slot (c807-slot.mjs: slot A %TEMP%\risu-b715\fullrun-slot or slot B, --slot a|b|any, default a) is acquired once
//   per attempt and released after it, also on failure; at least 95 s pass between a release and the next acquire of the same slot
//   (MC-2036), persisted across processes.
// - The host-free floor (--host-free-floor-gib, default 8) covers the whole rung: a parent-side poll of os.freemem() every 500 ms
//   covers the generator child, the server, Chrome, the census child and its retry. On a trip the active child is killed by its
//   recorded PID after a command-line check and the rung ends as host-floor, with the phase named.
// - Only PIDs this tool started are killed (server, Chrome, launcher, sampler, generator, census), by recorded PID after a command-line check.
// Fault knobs (scratch self-checks), C806_FAULT=<name>[,<name>]: truncate-bin (the .bin is cut in half and its sidecar rewritten, so
// the page gets a damaged file), no-sidecar (the sidecar is removed, so the guard must refuse), census-mismatch (the expected chat
// count is raised by one before the census comparison), faulty-chat (character 0 chat 0 starts with a cold-storage pointer whose
// unit the .bin lacks, so the import asks the incomplete-data question), commit-unknown and unit-upload-fail (CDP Fetch fails the
// final commit write, or the first unit write, of the page itself with a connection reset; the server never sees the failed
// request), reopen-read-fail (the reads of the installed tree after the post-import reload fail, so the boot stops on its
// blocked screen), page-crash (CDP Page.crash after the file is given), gen-fail (the generator child fails), preflight-fail-16 (the
// generator fails at median 16), census-guard-low and census-guard-always (the first census run, or both, fail as a tool: the
// tree folder is pointed at a missing path, because the census harness calls no memory guard), floor-high (the floor is the total
// RAM) with gen-slow (the generator child lingers 20 s, so the trip finds it running), hang (the done selector never matches), freeze (the page main thread is busy), and the mutants alert-blind,
// wait-blind, boot-screen-blind, progress-ends, refuse-answered, no-retry, census-fatal, retry-old-space-fixed, floor-rung-only, cap-as-crash
// and classify-swap, each a defect of the tool that a self-check must catch.
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
import { LIMIT_NOTE, acquire } from './c807-slot.mjs'
import { PASSING_CLASSES, PROBE_EXPRESSION, censusRetryLimit, classifyProbe, classifyStop, ladderVerdict, tableFromLangSource } from './c807-pageend.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const SAMPLER_PS1 = path.join(HERE, 'c806-proc-sampler.ps1')
// the slot owner text names the caller; --slot-text overrides this default (selfcheck children inherit it)
const SLOT_TEXT_DEFAULT = 'CHORE-807 G4 import ladder'
const slotText = () => arg('--slot-text', SLOT_TEXT_DEFAULT)
const SERVER_PORTS = [6860, 6889]
const RESTORE_RE = /백업 복원|Restore a backup|Restore backup/
const BLOCK_GAP_MS = 1000
const PROBE_EVERY_MS = 700
const FAULT = process.env.C806_FAULT ?? ''
const FAULTS = new Set(FAULT.split(',').map((s) => s.trim()).filter(Boolean))
const MIB = 2 ** 20
const SEED = 806
const COMMIT_KEY = 'store2-commit'
const COLD_STORAGE_HEADER = 'COLDSTORAGE'
const DEFAULT_FLOOR_GIB = 8

//#region full-run slot
let slotHandle = null
let slotWhich = 'a'
function releaseSlot() {
  if (slotHandle === null) return null
  const h = slotHandle
  slotHandle = null
  try { return h.release() } catch { return null }
}

async function acquireSlot(text) {
  const h = await acquire({ which: slotWhich, text })
  slotHandle = h
  return { waitedMs: h.waitedMs, slot: h.slot, otherAtAcquire: h.otherAtAcquire }
}
process.on('exit', releaseSlot)

// What a signal must end: the resources of the rung that is running, set by runRung and cleared when it finishes.
const live = { heap: null, phases: null, proc: null, h: null, server: null, generatorPid: null, censusPid: null, selfcheckPid: null, floor: null, phase: '' }
let signalled = false
/** Kills a recorded PID of this tool after a command-line check; true when it was killed. */
function killRecorded(pid, accepts) {
  if (pid === null || pid === undefined) return false
  const cmd = commandLineOf(pid)
  if (cmd === null || !accepts(cmd)) return false
  try { process.kill(pid) } catch { return false }
  return true
}
async function endLiveResources(signal) {
  if (signalled) return
  signalled = true
  // c807-slot.mjs exits right after its own signal handler, so the children are ended synchronously first
  try {
    killRecorded(live.generatorPid, (cmd) => cmd.includes('c806-import.mjs') && /\sgen\s/.test(cmd))
    killRecorded(live.censusPid, (cmd) => cmd.includes('vitest') && cmd.includes('c806-tree.harness'))
    killRecorded(live.selfcheckPid, (cmd) => cmd.includes('c806-import.mjs') && cmd.includes('selfcheck-one'))
    if (live.h) {
      killRecorded(live.h.chrome, (cmd) => /chrome\.exe/i.test(cmd))
      killRecorded(live.h.launcher, (cmd) => /launch-chrome\.mjs/.test(cmd))
    }
    if (live.server) killRecorded(live.server.pid, (cmd) => cmd.includes('server.cjs'))
    if (live.proc) killRecorded(live.proc.samplerPid, (cmd) => /c806-proc-sampler\.ps1/.test(cmd))
  } catch {}
  const steps = [
    () => live.floor?.end(), () => live.heap?.end(), () => live.phases?.end(), () => live.proc?.end(), () => (live.h ? closeChrome(live.h) : null), () => live.server?.stop(),
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

const hexOf = (key) => Buffer.from(key, 'utf8').toString('hex')

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

/** The page-end table: the import path's texts, read from the app's own en.ts and ko.ts. */
function pageTable() {
  const read = (name) => fs.readFileSync(path.join(REPO_ROOT, 'src', 'lang', name), 'utf8')
  return tableFromLangSource([read('en.ts'), read('ko.ts')])
}
//#endregion

//#region host-free floor
/**
 * A parent-side poll of os.freemem() every 500 ms. On a trip the active child is ended by its recorded PID after a command-line check
 * (generator, census) or through closeChrome (Chrome and, through it, the page); the phase that was active is recorded.
 */
function startFloorWatch(floorGiB) {
  const floorBytes = FAULTS.has('floor-high') ? os.totalmem() : floorGiB * 2 ** 30
  const rec = { floorGiB, floorBytes, tripped: null, minFreeBytes: os.freemem(), killed: [], timer: null, chromeClosed: false }
  // rejects on a trip, so a CDP call to the Chrome that the trip just closed (which never answers) cannot hold the rung
  let rejectTrip = () => {}
  rec.trippedPromise = new Promise((_, reject) => { rejectTrip = reject })
  rec.trippedPromise.catch(() => {})
  rec.check = () => {
    const free = os.freemem()
    rec.minFreeBytes = Math.min(rec.minFreeBytes, free)
    if (rec.tripped === null) {
      if (free >= floorBytes) return
      const phase = live.phase
      // mutant floor-rung-only: the floor is not watched while a child process runs
      if (FAULTS.has('floor-rung-only') && ['generator', 'census', 'census-retry', 'preflight'].includes(phase)) return
      rec.tripped = { phase, freeMiB: Math.round(free / MIB), at: new Date().toISOString() }
      rejectTrip(new Error('the host-free floor tripped in the ' + phase + ' phase (' + rec.tripped.freeMiB + ' MiB free)'))
    }
    // once tripped, a child that starts afterwards is ended as soon as it is recorded
    try {
      if (killRecorded(live.generatorPid, (cmd) => cmd.includes('c806-import.mjs') && /\sgen\s/.test(cmd))) rec.killed.push('generator')
      if (killRecorded(live.censusPid, (cmd) => cmd.includes('vitest') && cmd.includes('c806-tree.harness'))) rec.killed.push('census')
      if (live.h && !rec.chromeClosed) { rec.chromeClosed = true; rec.killed.push('chrome'); closeChrome(live.h).catch(() => {}) }
    } catch {}
  }
  rec.timer = setInterval(rec.check, 500)
  rec.end = () => clearInterval(rec.timer)
  return rec
}

function setPhase(phase) {
  live.phase = phase
  live.floor?.check()
}
//#endregion

//#region generation (child process: the library and the writer need a large heap)
async function generateBin({ out, median, params, logFile }) {
  const args = ['--max-old-space-size=16384', SELF, 'gen', '--out', out, '--median', String(median), '--characters', String(params.characters), '--chats', String(params.chats), '--modules', String(params.modules), '--archive', params.archive, '--seed', String(params.seed)]
  const logFd = fs.openSync(logFile, 'a')
  const t0 = Date.now()
  const child = spawn(process.execPath, args, { stdio: ['ignore', logFd, logFd], windowsHide: true, env: { ...process.env } })
  live.generatorPid = child.pid
  live.floor?.check()
  const code = await new Promise((resolve) => { child.on('exit', (c) => resolve(c)); child.on('error', () => resolve(-1)) })
  live.generatorPid = null
  fs.closeSync(logFd)
  return { code, ms: Date.now() - t0, pid: child.pid }
}

async function genCommand(argv) {
  const get = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
  if (FAULTS.has('gen-fail')) throw new Error('gen-fail knob: the generator child fails')
  if (FAULTS.has('preflight-fail-16') && Number(get('--median')) === 16) throw new Error('preflight-fail-16 knob: the generator fails at median 16')
  // knob gen-slow: the generator child lingers, so a host-free floor trip finds a running child to end
  if (FAULTS.has('gen-slow')) await sleep(20000)
  const lib = await import(pathToFileURL(path.join(REPO_ROOT, 'Agents', 'Tools', 'save-gen', 'c806-library.mjs')).href)
  const writer = await import(pathToFileURL(path.join(REPO_ROOT, 'Agents', 'Tools', 'save-gen', 'c806-bin-write.mjs')).href)
  const params = lib.normalizeParams({ seed: Number(get('--seed') ?? SEED), characters: Number(get('--characters')), chatsPerCharacter: Number(get('--chats')), messagesPerChat: Number(get('--median')), modules: Number(get('--modules')), archiveCharacters: get('--archive') !== 'off' })
  const out = get('--out')
  const database = lib.buildLibrary(params)
  const counts = lib.libraryCounts(database)
  if (FAULTS.has('faulty-chat')) {
    // the first message of the first chat names a cold-storage unit the .bin does not hold: resolve records an incomplete item
    const chat = database.characters[0].chats[0]
    if (chat.message.length === 0) chat.message.push({ role: 'char', data: '', time: 0 })
    chat.message[0].data = COLD_STORAGE_HEADER + 'c807-absent-unit'
  }
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
export function startHeapSampler(c, file) {
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
export function startPhasePoller(c) {
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
export async function startProcessSampler({ chromeCdpPort, serverPid, dir, maxSeconds }) {
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

/** The private bytes of one child PID every second (the generator child of the preflight); resolves with the peak at end(). */
function startPidSampler(pid, dir) {
  const pidFile = path.join(dir, 'pid-sampler-pids.txt')
  const stopFile = path.join(dir, 'pid-sampler-stop.txt')
  const outFile = path.join(dir, 'pid-proc.jsonl')
  fs.writeFileSync(pidFile, String(pid))
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', SAMPLER_PS1, '-PidFile', pidFile, '-OutFile', outFile, '-StopFile', stopFile, '-IntervalMs', '1000', '-ParentPid', String(process.pid), '-MaxSeconds', '7200'], { stdio: 'ignore', windowsHide: true })
  let exited = false
  child.on('exit', () => { exited = true })
  return {
    end: async () => {
      fs.writeFileSync(stopFile, 'stop')
      const t0 = Date.now()
      while (!exited && Date.now() - t0 < 15000) await sleep(200)
      if (!exited) killRecorded(child.pid, (cmd) => /c806-proc-sampler\.ps1/.test(cmd))
      const samples = readProcSamples(outFile)
      const priv = samples.flatMap((t) => t.p.map((e) => e.priv))
      return { samples: samples.length, peakPrivateMiB: priv.length ? mib(Math.max(...priv)) : null }
    },
  }
}
//#endregion

//#region analysis
export function analyseHeap(samples, from, to) {
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

export function readProcSamples(file) {
  if (!fs.existsSync(file)) return []
  const out = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line) continue
    try { out.push(JSON.parse(line)) } catch {}
  }
  return out
}

export function analyseProc(samples, types, from, to) {
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

/**
 * Fault knobs commit-unknown, unit-upload-fail and reopen-read-fail: CDP Fetch on the page's own /api/write-checked and /api/read*
 * requests, armed when the file is handed over. A failed request is a connection reset after the request left (an unknown outcome to
 * the app); the server never sees it. rec counts the requests it paused, so a run that paused none (a service worker answering
 * /api/*) is reported BLOCKED, never passed.
 * On the page import (the Welcome screen's restore) the commit of the library is a bulk commit (commit.ts bulk): its first commit-key
 * write is the bulk marker that precedes every unit upload, and its second is the final install write; commit-unknown fails the second.
 * reopen-read-fail leaves the import alone and, from the first main-frame navigation after the file (the reload after a landed
 * import), fails every read of a store2/ key other than the commit key, so the reloaded boot cannot read the installed tree.
 */
async function armFetchKnob(c, kind, rec) {
  const commitHex = hexOf(COMMIT_KEY)
  const store2Hex = hexOf('store2/')
  Object.assign(rec, { kind, paused: 0, matched: 0, failed: [], commitWrites: 0, commitFailed: false, unitFailed: false, navigated: false, pausedAfterNavigation: 0, readsFailedAfterNavigation: 0 })
  c.on((m) => {
    if (kind === 'reopen-read-fail' && m.method === 'Page.frameNavigated' && !m.params.frame.parentId && !rec.navigated) { rec.navigated = true; rec.navigatedAt = Date.now() }
    if (m.method !== 'Fetch.requestPaused') return
    const { requestId, request } = m.params
    rec.paused++
    if (rec.navigated) rec.pausedAfterNavigation++
    const headers = Object.fromEntries(Object.entries(request.headers ?? {}).map(([k, v]) => [k.toLowerCase(), String(v)]))
    const route = new URL(request.url).pathname
    const hexes = (headers['file-path'] ?? '').split('$$').filter(Boolean)
    let fail = false
    if (kind === 'commit-unknown') {
      if (route === '/api/write-checked' && hexes.includes(commitHex)) {
        rec.commitWrites++
        // the first commit write is the bulk marker that precedes the unit uploads; the second is the final install write
        if (rec.commitWrites === 2) { fail = true; rec.commitFailed = true }
      } else if (route === '/api/read' && rec.commitFailed && hexes.includes(commitHex)) fail = true
    } else if (kind === 'reopen-read-fail') {
      if (rec.navigated && (route === '/api/read' || route === '/api/read-range') && !hexes.includes(commitHex) && hexes.some((h) => h.startsWith(store2Hex))) {
        fail = true
        rec.readsFailedAfterNavigation++
      }
    } else if (route === '/api/write-checked' && !rec.unitFailed && !hexes.includes(commitHex) && hexes.some((h) => h.startsWith(store2Hex))) {
      fail = true
      rec.unitFailed = true
    }
    if (fail) {
      rec.matched++
      rec.failed.push({ route, keys: hexes.map((h) => Buffer.from(h, 'hex').toString('utf8')).slice(0, 3) })
      c.send('Fetch.failRequest', { requestId, errorReason: 'ConnectionReset' }).catch(() => {})
    } else c.send('Fetch.continueRequest', { requestId }).catch(() => {})
  })
  await c.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/write-checked*', requestStage: 'Request' }, { urlPattern: '*/api/read*', requestStage: 'Request' }] })
}
//#endregion

//#region census
function runCensus({ treeDir, tag, outRoot, logFile, oldSpaceMiB = 16384, rssLimitMiB = null, minFreeMiB, phase = 'census' }) {
  const vitest = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs')
  const env = { ...process.env, C806_MODE: 'census', C806_TREE_DIR: treeDir, C806_TAG: tag, C806_OUT_ROOT: outRoot, NODE_OPTIONS: `--max-old-space-size=${oldSpaceMiB}` }
  if (rssLimitMiB !== null) env.C806_RSS_LIMIT_MB = String(rssLimitMiB)
  if (minFreeMiB !== undefined) env.C806_MIN_FREE_MB = String(minFreeMiB)
  const recordedEnv = { NODE_OPTIONS: env.NODE_OPTIONS, C806_RSS_LIMIT_MB: env.C806_RSS_LIMIT_MB ?? null, C806_MIN_FREE_MB: env.C806_MIN_FREE_MB ?? null, C806_TREE_DIR: treeDir }
  const logFd = fs.openSync(logFile, 'a')
  setPhase(phase)
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [vitest, 'run', '--config', 'Agents/Tools/vitest.harness.config.ts', 'Agents/Tools/save-gen/c806-tree.harness.ts'], { cwd: REPO_ROOT, env, stdio: ['ignore', logFd, logFd], windowsHide: true })
    live.censusPid = child.pid
    live.floor?.check()
    child.on('exit', (code) => { live.censusPid = null; fs.closeSync(logFd); resolve({ code, env: recordedEnv }) })
    child.on('error', () => { live.censusPid = null; fs.closeSync(logFd); resolve({ code: -1, env: recordedEnv }) })
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

/**
 * The census of the imported tree against the .bin's parameters. A first run that fails as a tool (no census.json, or an exit
 * that its own result does not explain) is retried once while the tree still exists, with the census child's V8 old space raised
 * to L = min(28672, host free MiB - floor MiB - 2048); with L at or below 16384 the retry is skipped and recorded as "no headroom".
 * Returns { toolFailed, mismatch, census (the record), file }.
 */
async function censusOf({ rung, d, o, tag, runDir, floor }) {
  const base = { treeDir: d.save, outRoot: o.outDir, minFreeMiB: Math.round(floor.floorBytes / MIB) }
  const attempts = []
  const one = async (extra, label, phase) => {
    const t0 = Date.now()
    // knobs census-guard-low (first run) and census-guard-always (both): the run fails as a tool before any census is written.
    // The harness calls no memory guard in census mode, so the failure is a missing tree folder, not C806_RSS_LIMIT_MB.
    const broken = (label === 'first' && (FAULTS.has('census-guard-low') || FAULTS.has('census-guard-always'))) || (label === 'retry' && FAULTS.has('census-guard-always'))
    const treeDir = broken ? path.join(runDir, 'c807-missing-tree') : d.save
    const censusTag = tag + '-census' + (label === 'retry' ? '-retry' : '')
    const r = await runCensus({ ...base, ...extra, treeDir, tag: censusTag, logFile: path.join(runDir, 'census' + (label === 'retry' ? '-retry' : '') + '.log'), phase })
    const file = path.join(o.outDir, censusTag, 'census.json')
    const a = { label, exitCode: r.code, env: r.env, ms: Date.now() - t0, file, wrote: fs.existsSync(file), knobBroken: broken }
    attempts.push(a)
    return a
  }
  let last = await one({}, 'first', 'census')
  let toolFailed = last.exitCode !== 0 && !last.wrote
  let retry = { done: false }
  if (toolFailed && !FAULTS.has('census-fatal') && floor.tripped === null) {
    const freeMiB = Math.floor(os.freemem() / MIB)
    const floorMiB = Math.round(floor.floorBytes / MIB)
    const { limitMiB: limit, skipped } = censusRetryLimit(freeMiB, floorMiB)
    if (skipped) {
      retry = { done: false, skipped: 'no headroom', freeMiB, floorMiB, limitMiB: limit }
    } else {
      // mutant retry-old-space-fixed: the retry keeps the fixed 16384
      const oldSpaceMiB = FAULTS.has('retry-old-space-fixed') ? 16384 : limit
      retry = { done: true, freeMiB, floorMiB, limitMiB: limit, oldSpaceMiB }
      last = await one({ oldSpaceMiB, rssLimitMiB: limit }, 'retry', 'census-retry')
      toolFailed = last.exitCode !== 0 && !last.wrote
    }
  }
  const record = { exitCode: last.exitCode, file: last.file, attempts, retry }
  if (!last.wrote) return { toolFailed: true, mismatch: false, census: record, file: last.file }
  const census = JSON.parse(fs.readFileSync(last.file, 'utf8'))
  // the census-mismatch knob raises the expected chat count by one: the comparison must then fail the rung
  const wanted = FAULTS.has('census-mismatch') ? { ...rung.bin.counts, chats: rung.bin.counts.chats + 1 } : rung.bin.counts
  record.againstParams = compareCensusToParams(census, wanted)
  if (o.stage1Census) record.againstStage1 = compareCensusToTree(census, o.stage1Census)
  const mismatch = record.againstParams.equal !== true
  // an exit the result does not explain (a census that wrote its file but exited non-zero with equal counts) is a tool failure
  const unexplained = last.exitCode !== 0 && !mismatch
  return { toolFailed: unexplained, mismatch, census: record, file: last.file }
}
//#endregion

//#region one rung
/** The page's main thread answers within 10 s: the cap was a stall, not a hung or busy tab. */
async function aliveAtCap(c) {
  try {
    await guarded(c.send('Runtime.evaluate', { expression: '1' }), 10000, 'cap liveness')
    return 'cap-alive'
  } catch { return 'cap-unresponsive' }
}

async function runRung(o, median, slotInfo) {
  const floor = startFloorWatch(o.floorGiB)
  live.floor = floor
  try {
    return await runRungBody(o, median, slotInfo, floor)
  } finally {
    floor.end()
    live.floor = null
    live.phase = ''
  }
}

async function runRungBody(o, median, slotInfo, floor) {
  const tag = 'imp-m' + String(median).replace('.', 'p') + '-' + Date.now()
  const runDir = scratchPath(o.outDir, tag)
  fs.mkdirSync(runDir, { recursive: true })
  const rung = { tag, median, status: 'failed', class: null, why: null, slot: slotInfo, startedAt: new Date().toISOString(), fault: FAULT || null, params: { seed: SEED, characters: o.characters, chats: o.chats, modules: o.modules, archive: o.archive }, figures: null }
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
  const raced = (promise) => Promise.race([promise, floor.trippedPromise])
  const cur = { crashed: false }
  // what was seen, for classifyStop
  const ev = { pageEnd: null, cap: null, importedHome: false, chromeExited: false, toolError: null }
  const fileGiven = { at: null }
  const fetchRec = {}
  let pageEndInfo = null
  try {
    // 1: the .bin
    if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('no measurement dist at ' + dist)
    setPhase('generator')
    const gen = await generateBin({ out: bin, median, params: rung.params, logFile: path.join(runDir, 'gen.log') })
    rung.generator = { exitCode: gen.code, ms: gen.ms, pid: gen.pid }
    if (gen.code !== 0 || !fs.existsSync(bin + '.c806.json')) {
      rung.generator.tail = fs.existsSync(path.join(runDir, 'gen.log')) ? fs.readFileSync(path.join(runDir, 'gen.log'), 'utf8').slice(-600) : ''
      throw new Error('generator failed (exit ' + gen.code + ')')
    }
    const side = JSON.parse(fs.readFileSync(bin + '.c806.json', 'utf8'))
    const expected = JSON.parse(fs.readFileSync(bin + '.counts.json', 'utf8'))
    rung.bin = { fileBytes: side.fileBytes, entryBytes: side.entryBytes, sha256: side.sha256, counts: expected.counts }
    if (FAULTS.has('truncate-bin')) {
      const bytes = fs.readFileSync(bin)
      const cut = bytes.subarray(0, Math.floor(bytes.length / 2))
      fs.writeFileSync(bin, cut)
      side.sha256 = createHash('sha256').update(cut).digest('hex')
      side.fileBytes = cut.length
      fs.writeFileSync(bin + '.c806.json', JSON.stringify(side))
    }
    if (FAULTS.has('no-sidecar')) fs.rmSync(bin + '.c806.json', { force: true })
    // 2: empty server, fresh profile
    setPhase('server')
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
    setPhase('chrome')
    h = await launchChrome({ runDir, profileName: tag })
    live.h = h
    rung.pids = { server: server.pid, serverPort: server.port, chrome: h.chrome, launcher: h.launcher, cdpPort: h.cdpPort }
    const switches = { 'risu-measure-import': 'on', 'risu-measure-savepass': 'off' }
    const { c, state } = await raced(attach(h, { switches }))
    c.on((m) => { if (m.method === 'Inspector.targetCrashed') cur.crashed = true })
    const version = await raced(c.send('Browser.getVersion'))
    rung.chromeVersion = version.product
    // The page's language follows the browser language and is recorded (rung.pageLanguage), not pinned: c806-page.mjs importBinThroughPage
    // answers the restore confirmation with a case-sensitive /^(예|Yes)$/, which the English UI's "YES" label does not match.
    heap = startHeapSampler(c, path.join(runDir, 'heap.jsonl'))
    live.heap = heap
    phases = startPhasePoller(c)
    live.phases = phases
    // the sampler also ends when this process is gone, or after the cap plus ten minutes
    proc = await raced(startProcessSampler({ chromeCdpPort: h.cdpPort, serverPid: server.pid, dir: runDir, maxSeconds: Math.ceil(o.capMs / 1000) + 600 }))
    live.proc = proc
    rung.samplerPid = proc.samplerPid
    // 3: login and the first screen with the restore button
    setPhase('import')
    const tNav = Date.now()
    await raced(c.send('Page.navigate', { url: server.baseUrl + '/' }))
    rung.offer = await raced(reachOffer(c, 3 * 60 * 1000))
    try { rung.pageLanguage = await guarded(c.ev('navigator.language'), 8000, 'navigator.language') } catch (e) { rung.pageLanguageError = String(e.message).slice(0, 200) }
    // 4: the import
    const logLines = []
    rung.importLog = logLines
    // After the file is handed over, one probe every 700 ms reads every alert box and the boot screen. A size, time or space warning
    // ("Continue?") is answered Yes, as the maintainer's import test does, and a known progress wait passes. Anything else ends the
    // rung at once (nothing else is ever answered), and is labelled afterwards from its recorded text.
    rung.confirmsAnswered = []
    rung.progressSeen = []
    rung.probeCount = 0
    const table = pageTable()
    const liveTable = FAULTS.has('progress-ends') ? { ...table, progress: [] } : table
    let stopProbe = false
    const pageEndP = new Promise((resolve) => {
      const lastClick = { at: 0 }
      ;(async () => {
        while (!stopProbe) {
          await sleep(PROBE_EVERY_MS)
          if (stopProbe || fileGiven.at === null) continue
          let probe = null
          try { probe = await guarded(c.ev(PROBE_EXPRESSION), 8000, 'page probe') } catch { probe = null }
          if (!probe || stopProbe) continue
          rung.probeCount++
          // mutants alert-blind and boot-screen-blind: one of the two watched surfaces is off
          if (FAULTS.has('alert-blind')) probe = { ...probe, alerts: [] }
          if (FAULTS.has('boot-screen-blind')) probe = { ...probe, boot: null }
          // mutant wait-blind: buttonless alert boxes (a wait or progress box) are dropped before classification
          if (FAULTS.has('wait-blind')) probe = { ...probe, alerts: probe.alerts.filter((a) => a.buttons.length > 0) }
          const decision = classifyProbe(probe, liveTable)
          if (decision.kind === 'progress') {
            for (const a of probe.alerts) if (a.buttons.length === 0 && rung.progressSeen.length < 40 && !rung.progressSeen.includes(a.text.slice(0, 80))) rung.progressSeen.push(a.text.slice(0, 80))
          } else if (decision.kind === 'answer') {
            if (Date.now() - lastClick.at > 1500) {
              lastClick.at = Date.now()
              if (await mouseClick(c, /^(예|yes)$/i)) rung.confirmsAnswered.push({ afterFileMs: Date.now() - fileGiven.at, text: probe.alerts.map((a) => a.text).join(' | ').slice(0, 220) })
            }
          } else if (decision.kind === 'end') {
            // mutant refuse-answered: the incomplete-data confirmation is answered instead of ending the rung
            if (FAULTS.has('refuse-answered') && decision.label === 'page-refused') {
              if (Date.now() - lastClick.at > 1500) {
                lastClick.at = Date.now()
                if (await mouseClick(c, /^(예|yes)$/i)) rung.confirmsAnswered.push({ afterFileMs: Date.now() - fileGiven.at, text: 'refuse-answered: ' + probe.alerts.map((a) => a.text).join(' | ').slice(0, 200) })
              }
              continue
            }
            resolve({ tag: 'page-end', decision, probe, at: Date.now() })
            return
          }
        }
      })()
    })
    let watchTimer = null
    const watchP = new Promise((resolve) => {
      watchTimer = setInterval(() => {
        if (cur.crashed) { clearInterval(watchTimer); resolve({ tag: 'crash' }) } else if (h.hasExited()) { clearInterval(watchTimer); resolve({ tag: 'chrome-exit' }) }
      }, 500)
    })
    let capTimer = null
    // the cap also bounds a tab that no longer answers, which the import loop's own timeout cannot
    const capP = new Promise((resolve) => { capTimer = setTimeout(() => resolve({ tag: 'cap-timer' }), o.capMs + 3000) })
    const knobArmed = FAULTS.has('commit-unknown') ? 'commit-unknown' : FAULTS.has('unit-upload-fail') ? 'unit-upload-fail' : FAULTS.has('reopen-read-fail') ? 'reopen-read-fail' : null
    const doneSelector = FAULTS.has('hang') ? '[data-part=c807-never-shown]' : '[data-part=home-landing], [data-part=chat-messages]'
    const importing = importBinThroughPage(c, bin, {
      restoreLabel: RESTORE_RE, doneSelector, timeoutMs: o.capMs,
      log: (m) => {
        if (m.startsWith('file given')) {
          fileGiven.at = Date.now()
          if (knobArmed) armFetchKnob(c, knobArmed, fetchRec).catch((e) => { fetchRec.error = String(e.message).slice(0, 200) })
          if (FAULTS.has('page-crash')) setTimeout(() => { c.send('Page.crash').catch(() => {}) }, 1500)
          if (FAULTS.has('freeze')) setTimeout(() => { c.send('Runtime.evaluate', { expression: '(() => { const t = Date.now(); while (Date.now() - t < 300000) {} })()' }).catch(() => {}) }, 300)
        }
        if (logLines.length < 400) logLines.push(Date.now() + ' ' + m)
      },
    })
    const importingP = importing.then((outcome) => ({ tag: 'home', outcome }), (error) => ({ tag: 'import-error', error }))
    const floorP = floor.trippedPromise.then(() => null, () => ({ tag: 'floor' }))
    let first
    try {
      first = await Promise.race([importingP, watchP, pageEndP, capP, floorP])
    } finally {
      stopProbe = true
      clearInterval(watchTimer)
      clearTimeout(capTimer)
    }
    const endedAt = Date.now()
    rung.endTag = first.tag
    if (fetchRec.kind) rung.faultFetch = { kind: fetchRec.kind, paused: fetchRec.paused, matched: fetchRec.matched, failed: fetchRec.failed, commitWrites: fetchRec.commitWrites, commitFailed: fetchRec.commitFailed, unitFailed: fetchRec.unitFailed, navigated: fetchRec.navigated, navigatedAt: fetchRec.navigatedAt ?? null, pausedAfterNavigation: fetchRec.pausedAfterNavigation, readsFailedAfterNavigation: fetchRec.readsFailedAfterNavigation, error: fetchRec.error ?? null }
    if (first.tag === 'page-end') {
      ev.pageEnd = first.decision.label
      pageEndInfo = { label: first.decision.label, alertType: first.decision.alertType, alertText: first.decision.text, blockedReason: first.decision.blockedReason ?? null, blockedDetail: first.decision.blockedDetail ?? null, probe: first.probe, fileToEndMs: fileGiven.at === null ? null : first.at - fileGiven.at }
    } else if (first.tag === 'crash') {
      cur.crashed = true
    } else if (first.tag === 'chrome-exit') {
      ev.chromeExited = true
    } else if (first.tag === 'cap-timer' || (first.tag === 'import-error' && /^the import did not finish/.test(first.error.message))) {
      ev.cap = await aliveAtCap(c)
      rung.capNote = first.tag === 'cap-timer' ? 'the cap timer fired' : String(first.error.message).slice(0, 300)
    } else if (first.tag === 'import-error') {
      throw first.error
    }
    await phases.take()
    rung.fileGivenAt = fileGiven.at
    rung.fileToEndMs = fileGiven.at === null ? null : endedAt - fileGiven.at
    rung.navigationsTotal = state.navigations
    if (first.tag === 'home') {
      const doneAt = endedAt
      if (fileGiven.at === null) throw new Error('the file was never handed to the picker')
      rung.importLog = logLines
      rung.fileToHomeMs = doneAt - fileGiven.at
      rung.clickToHomeMs = first.outcome.ms
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
      ev.importedHome = true
      rung.window = { fileGivenAt: fileGiven.at, doneAt, settledAt, tNav }
    }
  } catch (e) {
    rung.status = 'failed'
    rung.why = String(e.message).slice(0, 600)
    ev.toolError = rung.why
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
  rung.reqlog = aggregateReqlog(lines, rung.fileGivenAt ?? null)
  rung.phases = phases ? phases.best : []
  rung.samplerErrors = proc ? proc.errors.slice(0, 5) : []
  rung.samplerKilled = proc ? (proc.killed ?? false) : null
  fs.writeFileSync(path.join(runDir, 'phases.json'), JSON.stringify(rung.phases, null, 2))
  const procWhole = proc && procSamples.length ? analyseProc(procSamples, proc.types, 0, Infinity) : null
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
  const censusEv = { skipped: !o.census, mismatch: false, toolFailed: false }
  if (rung.status === 'imported' && o.census && floor.tripped === null) {
    const result = await censusOf({ rung, d, o, tag, runDir, floor })
    rung.census = result.census
    censusEv.mismatch = result.mismatch
    censusEv.toolFailed = result.toolFailed
    // mutant census-fatal: a census that fails as a tool is a tool failure of the whole rung, not an unverified figure
    if (FAULTS.has('census-fatal') && result.toolFailed) { ev.toolError = 'the census harness failed as a tool (census-fatal)'; censusEv.toolFailed = false }
  }
  // the class (c807-pageend.mjs classifyStop): ok only with a census that equals the .bin's parameters; a skipped or tool-failed census
  // is unverified; anything else is failed and keeps no figure
  if (rung.status === 'imported' && floor.tripped === null) {
    // the app emits 'import commit start' but no commit-end phase: the start note must be in the ring, the end is recorded as not emitted
    const commitStart = rung.phases.some(p => /import commit start/.test(p.phase))
    rung.phaseChecks = { importCommitStartPresent: commitStart, commitEndPhaseEmittedByApp: false, phasesSeen: rung.phases.length }
    if (!commitStart && o.census && !censusEv.mismatch && !censusEv.toolFailed) ev.toolError = 'the phase ring has no "import commit start" note'
  }
  let evidence = {
    crashed: cur.crashed && floor.tripped === null, chromeExited: ev.chromeExited && floor.tripped === null, floorTripped: floor.tripped !== null,
    pageEnd: ev.pageEnd, cap: ev.cap, importedHome: ev.importedHome, censusSkipped: censusEv.skipped, censusMismatch: censusEv.mismatch,
    censusToolFailed: censusEv.toolFailed, toolError: ev.toolError,
  }
  // mutant cap-as-crash: a stalled tab is reported as a crash
  if (FAULTS.has('cap-as-crash') && evidence.cap) evidence = { ...evidence, crashed: true }
  // mutant classify-swap: a crash is reported as a tool failure
  if (FAULTS.has('classify-swap')) evidence = { ...evidence, crashed: false, chromeExited: false, toolError: evidence.toolError ?? 'swapped class' }
  rung.class = classifyStop(evidence)
  rung.evidence = evidence
  rung.status = rung.class === 'ok' ? 'ok' : PASSING_CLASSES.has(rung.class) ? 'unverified' : 'failed'
  if (rung.class === 'unverified') rung.why = 'the census was skipped (--no-census): the figures are not checked against the imported tree'
  else if (rung.class === 'census-unverified') rung.why = 'the census failed as a tool, also on the retry: the figures are not checked against the imported tree (' + (rung.census?.retry?.skipped ?? 'retry ran') + ')'
  else if (rung.class === 'page-mismatch') rung.why = 'the imported tree differs from the .bin parameters: ' + JSON.stringify(rung.census.againstParams.fields) + ' ' + JSON.stringify(rung.census.againstParams.problems).slice(0, 300)
  else if (rung.class === 'host-floor') rung.why = 'the host-free floor tripped in the ' + floor.tripped.phase + ' phase (' + floor.tripped.freeMiB + ' MiB free)'
  else if (rung.class !== 'ok' && rung.why === null) rung.why = pageEndInfo ? rung.class + ': ' + String(pageEndInfo.alertText ?? '').slice(0, 300) : rung.class + (rung.capNote ? ': ' + rung.capNote : ev.toolError ? ': ' + ev.toolError : '')
  if (rung.status === 'failed') {
    rung.figures = null
    fs.rmSync(path.join(runDir, 'series.json'), { force: true })
  }
  rung.floor = { floorGiB: floor.floorGiB, tripped: floor.tripped, minFreeMiB: Math.round(floor.minFreeBytes / MIB), killed: floor.killed }
  if (rung.generator?.pid) {
    try { rung.generator.pidGone = commandLineOf(rung.generator.pid) === null } catch {}
  }
  // atFailure, for every class but ok and unverified: kept apart from figures (a failed rung has no figure)
  if (rung.class !== 'ok' && rung.class !== 'unverified') {
    const lastPhase = rung.phases.length ? rung.phases[rung.phases.length - 1] : null
    rung.atFailure = {
      class: rung.class,
      lastPhase: lastPhase ? { phase: lastPhase.phase, heapMiB: lastPhase.heapMiB ?? null } : null,
      highestRendererPrivateMiB: procWhole?.pageRendererGuess?.peakPrivateMiB ?? null,
      fileToEndMs: rung.fileToEndMs ?? null,
      hostFreeMiB: Math.round(os.freemem() / MIB),
      alertType: pageEndInfo?.alertType ?? null,
      alertText: pageEndInfo?.alertText ?? null,
      blockedReason: pageEndInfo?.blockedReason ?? null,
      blockedDetail: pageEndInfo?.blockedDetail ?? null,
      probe: pageEndInfo?.probe ?? null,
      // the last phase notes name the cause of an end whose alert text is generic
      phaseRing: rung.phases,
      hostFloor: rung.floor.tripped,
      censusError: rung.class === 'census-unverified' ? rung.census : null,
    }
  }
  // provenance and the record
  rung.provenance = {
    head: gitText('rev-parse', 'HEAD'), statusToolsAndSrc: gitText('status', '--short', '--', 'Agents/Tools', 'src').split('\n').filter(Boolean),
    toolSha256: Object.fromEntries(['c806-import.mjs', 'c806-proc-sampler.ps1', 'c806-page.mjs', 'c806-server.mjs', 'c806-reqlog.cjs', 'c807-slot.mjs', 'c807-pageend.mjs'].map((n) => [n, sha256File(path.join(HERE, n))])),
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
  rung.treeKept = false
  if (o.keepTree) rung.treeKept = d.save
  else {
    try { fs.rmSync(d.save, { recursive: true, force: true }) } catch {}
  }
  fs.writeFileSync(path.join(runDir, 'rung.json'), JSON.stringify(rung, null, 2))
  return rung
}
//#endregion

//#region generator preflight
/**
 * The generator child alone, descending through the rung list until one passes: time, exit code, peak private bytes (sampled every
 * second by PID) and .bin bytes are recorded and the .bin is deleted. The cap of a later ladder is the highest rung that passes.
 */
async function runPreflight(o) {
  const out = o.outDir
  fs.mkdirSync(out, { recursive: true })
  const floor = startFloorWatch(o.floorGiB)
  live.floor = floor
  const result = { startedAt: new Date().toISOString(), requested: o.rungs, params: { seed: SEED, characters: o.characters, chats: o.chats, modules: o.modules, archive: o.archive }, rungs: [], cap: null, lowered: null }
  try {
    setPhase('preflight')
    for (const median of o.rungs) {
      const tag = 'pre-m' + String(median).replace('.', 'p') + '-' + Date.now()
      const dir = scratchPath(out, tag)
      fs.mkdirSync(dir, { recursive: true })
      const bin = path.join(dir, tag + '.bin')
      const t0 = Date.now()
      const rec = { median, tag }
      let sampler = null
      const params = result.params
      const args = ['--max-old-space-size=16384', SELF, 'gen', '--out', bin, '--median', String(median), '--characters', String(params.characters), '--chats', String(params.chats), '--modules', String(params.modules), '--archive', params.archive, '--seed', String(params.seed)]
      const logFd = fs.openSync(path.join(dir, 'gen.log'), 'a')
      const child = spawn(process.execPath, args, { stdio: ['ignore', logFd, logFd], windowsHide: true, env: { ...process.env } })
      live.generatorPid = child.pid
      sampler = startPidSampler(child.pid, dir)
      live.floor?.check()
      rec.exitCode = await new Promise((resolve) => { child.on('exit', (c) => resolve(c)); child.on('error', () => resolve(-1)) })
      live.generatorPid = null
      fs.closeSync(logFd)
      rec.ms = Date.now() - t0
      rec.rss = await sampler.end()
      rec.binBytes = fs.existsSync(bin) ? fs.statSync(bin).size : null
      rec.ok = rec.exitCode === 0 && rec.binBytes !== null && fs.existsSync(bin + '.c806.json') && floor.tripped === null
      if (!rec.ok) rec.tail = fs.existsSync(path.join(dir, 'gen.log')) ? fs.readFileSync(path.join(dir, 'gen.log'), 'utf8').slice(-400) : ''
      for (const f of [bin, bin + '.c806.json', bin + '.counts.json']) fs.rmSync(f, { force: true })
      rec.binDeleted = !fs.existsSync(bin)
      result.rungs.push(rec)
      fs.writeFileSync(path.join(out, 'preflight.json'), JSON.stringify(result, null, 2))
      console.log(`preflight rung ${median}: exit ${rec.exitCode}, ${Math.round(rec.ms / 1000)} s, peak private ${rec.rss.peakPrivateMiB} MiB, .bin ${rec.binBytes} bytes${rec.ok ? '' : ' FAILED'}`)
      if (floor.tripped !== null) { result.floor = floor.tripped; break }
      if (rec.ok) { result.cap = median; break }
    }
    const top = o.rungs[0]
    if (result.cap !== null && result.cap !== top) result.lowered = `the cap is ${result.cap}, below the requested ${top}: the generator failed at ${result.rungs.filter((r) => !r.ok).map((r) => r.median).join(', ')} (exit ${result.rungs.filter((r) => !r.ok).map((r) => r.exitCode).join(', ')})`
    if (result.cap === null) result.lowered = 'no rung passed: ' + (result.floor ? 'the host-free floor tripped in the preflight phase' : 'every generator run failed')
  } finally {
    floor.end()
    live.floor = null
    live.phase = ''
    result.floorRecord = { floorGiB: floor.floorGiB, minFreeMiB: Math.round(floor.minFreeBytes / MIB), tripped: floor.tripped }
    result.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(out, 'preflight.json'), JSON.stringify(result, null, 2))
  }
  return result
}
//#endregion

//#region ladder
/** The headline figures of a rung that carries any; the heap figure is the page's phase ring, the CDP figure is labelled as between blocks. */
function figureSummary(r) {
  const f = r.figures
  return { phaseRingPeakHeapMiB: f.phaseRingPeakHeapMiB, cdpHeapPeakBetweenBlocksMiB: f.heapDuringImport.cdpHeapPeakBetweenBlocksMiB, rendererPrivatePeakMiB: f.processesDuringImport.pageRendererGuess?.peakPrivateMiB ?? null, maxCdpHeapGapMs: f.heapDuringImport.maxGapMs }
}

function rungLine(r) {
  if (r.status === 'failed' || r.figures === null) return `rung ${r.median}: FAILED, ${r.class ?? 'tool'} (${r.why})`
  const s = figureSummary(r)
  const unchecked = r.status === 'unverified' ? ` [UNVERIFIED: ${r.class}]` : ''
  return `rung ${r.median}: ${r.status}${unchecked}, file to home ${Math.round(r.fileToHomeMs / 1000)} s, phase-ring heap peak ${s.phaseRingPeakHeapMiB ?? 'n/a'} MiB, page renderer private peak ${s.rendererPrivatePeakMiB ?? 'n/a'} MiB, CDP heap peak between blocks ${s.cdpHeapPeakBetweenBlocksMiB} MiB, max CDP heap gap ${s.maxCdpHeapGapMs} ms`
}

function runRecord(o) {
  const distIndex = path.join(scratchPath(C806_ROOT, 'build', 'dist'), 'index.html')
  const buildJson = path.join(scratchPath(C806_ROOT, 'build'), 'build.json')
  return {
    base: gitText('rev-parse', 'HEAD'), status: gitText('status', '--short', '--', 'Agents/Tools', 'src', 'server').split('\n').filter(Boolean),
    toolSha256: Object.fromEntries(['c806-import.mjs', 'c806-proc-sampler.ps1', 'c806-page.mjs', 'c806-server.mjs', 'c806-reqlog.cjs', 'c807-slot.mjs', 'c807-pageend.mjs'].map((n) => [n, sha256File(path.join(HERE, n))])),
    distIndexSha256: fs.existsSync(distIndex) ? sha256File(distIndex) : null, buildJson: fs.existsSync(buildJson) ? JSON.parse(fs.readFileSync(buildJson, 'utf8')) : null,
    params: { rungs: o.rungs, characters: o.characters, chats: o.chats, modules: o.modules, archive: o.archive, capMin: o.capMs / 60000, census: o.census, confirmFailure: o.confirmFailure, floorGiB: o.floorGiB, keepTree: o.keepTree },
    cpu: os.cpus()[0].model + ' x' + os.cpus().length, ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version, platform: os.platform() + ' ' + os.release(),
    fault: FAULT || null, slotRequested: slotWhich, slotGapVisibilityLimit: LIMIT_NOTE,
    hardwareCaveat: 'best-case desktop hardware (i9-13900KF, 64 GiB); diagnostic numbers, not thresholds, nothing about phones or a Pi',
  }
}

async function runLadder(o) {
  fs.mkdirSync(o.outDir, { recursive: true })
  const ladder = { startedAt: new Date().toISOString(), rungs: [], stoppedAt: null, stopWhy: null, verdict: null, notes: [] }
  const runJson = { ...runRecord(o), startedAt: ladder.startedAt, slots: [] }
  const attempts = []
  const bins = []
  const saveRun = () => fs.writeFileSync(path.join(o.outDir, 'run.json'), JSON.stringify(runJson, null, 2))
  saveRun()
  outer: for (let i = 0; i < o.rungs.length; i++) {
    const median = o.rungs[i]
    for (;;) {
      const slot = await acquireSlot(slotText())
      let rung
      try {
        rung = await runRung(o, median, slot)
      } catch (e) {
        rung = { median, status: 'failed', class: 'tool', why: 'tool error: ' + String(e.stack ?? e).slice(0, 600), figures: null }
      } finally {
        const released = releaseSlot()
        runJson.slots.push({ median, tag: rung?.tag ?? null, slot: slot.slot, waitedMs: slot.waitedMs, otherAtAcquire: slot.otherAtAcquire, otherAtRelease: released?.otherAtRelease ?? null })
        saveRun()
      }
      attempts.push({ median, class: rung.class, why: rung.why, tag: rung.tag, atFailure: rung.atFailure ? { alertType: rung.atFailure.alertType, alertText: rung.atFailure.alertText } : undefined })
      ladder.rungs.push({ median, tag: rung.tag, status: rung.status, class: rung.class, why: rung.why, fileToHomeMs: rung.status === 'failed' ? null : rung.fileToHomeMs ?? null, censusAgainstParamsEqual: rung.census?.againstParams?.equal ?? null, censusAgainstStage1Equal: rung.census?.againstStage1?.equal ?? null, figures: rung.status !== 'failed' && rung.figures ? figureSummary(rung) : null, atFailure: rung.atFailure ? { alertType: rung.atFailure.alertType, alertText: rung.atFailure.alertText, blockedReason: rung.atFailure.blockedReason, fileToEndMs: rung.atFailure.fileToEndMs } : null })
      if (rung.bin) bins.push({ tag: rung.tag, median, fileBytes: rung.bin.fileBytes, sha256: rung.bin.sha256, deleted: rung.binDeleted ?? false })
      fs.writeFileSync(path.join(o.outDir, 'ladder.json'), JSON.stringify(ladder, null, 2))
      fs.writeFileSync(path.join(o.outDir, 'bins.json'), JSON.stringify(bins, null, 2))
      console.log(rungLine(rung))
      let step = ladderVerdict(attempts, { confirm: o.confirmFailure, planned: o.rungs })
      // mutant no-retry: a tool failure (or a confirming re-run) is not tried again
      if (step.action === 'rerun' && FAULTS.has('no-retry')) step = { action: 'stop', verdict: 'UNRESOLVED above rung ' + (i > 0 ? o.rungs[i - 1] : 'none') + ' (' + rung.class + ': ' + String(rung.why ?? '').slice(0, 200) + ')', note: null }
      if (step.note) ladder.notes.push(step.note)
      if (step.action === 'rerun') continue
      if (step.action === 'stop') {
        ladder.verdict = step.verdict
        if (!/^no breaking point/.test(step.verdict)) { ladder.stoppedAt = median; ladder.stopWhy = step.verdict }
        break outer
      }
      break
    }
  }
  ladder.finishedAt = new Date().toISOString()
  fs.writeFileSync(path.join(o.outDir, 'ladder.json'), JSON.stringify(ladder, null, 2))
  runJson.finishedAt = ladder.finishedAt
  runJson.verdict = ladder.verdict
  saveRun()
  console.log('VERDICT ' + (ladder.verdict ?? 'ladder ended without a verdict'))
  return ladder
}
//#endregion

//#region commands
const argv = process.argv.slice(2)
const arg = (k, fallback = null) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : fallback }
const has = (k) => argv.includes(k)

function optionsFromArgs(extra = {}) {
  const outDir = scratchPath(arg('--out', path.join(C806_ROOT, 'runs', 'stage4')))
  const slot = arg('--slot', 'a')
  if (!['a', 'b', 'any'].includes(slot)) throw new Error('--slot must be a, b or any: ' + slot)
  slotWhich = slot
  const o = {
    rungs: (arg('--rungs', '0.5,1,2,4')).split(',').map(Number), characters: Number(arg('--characters', '1000')), chats: Number(arg('--chats', '20')), modules: Number(arg('--modules', '180')),
    archive: arg('--archive', 'on'), capMs: Math.round(Number(arg('--cap-min', '60')) * 60000), census: !has('--no-census'), keepBin: has('--keep-bin'), keepTree: has('--keep-tree'),
    confirmFailure: has('--confirm-failure'), floorGiB: Number(arg('--host-free-floor-gib', String(DEFAULT_FLOOR_GIB))),
    stage1Census: arg('--stage1-census'), outDir, ...extra,
  }
  const preflight = arg('--preflight')
  if (preflight) {
    // the ladder is capped by the highest rung whose generator preflight passed
    const result = JSON.parse(fs.readFileSync(preflight, 'utf8'))
    if (result.cap === null) throw new Error('the preflight passed no rung: ' + preflight)
    o.preflightCap = result.cap
    o.rungs = o.rungs.filter((m) => m <= result.cap)
  }
  return o
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const cmd = argv[0]
  process.on('SIGINT', () => { endLiveResources('SIGINT') })
  process.on('SIGTERM', () => { endLiveResources('SIGTERM') })
  if (cmd === 'gen') {
    await genCommand(argv)
  } else if (cmd === 'gen-preflight') {
    const o = optionsFromArgs({ rungs: (arg('--rungs', '16,12,10')).split(',').map(Number), outDir: scratchPath(arg('--out', path.join(C806_ROOT, 'runs', 'preflight'))) })
    const slot = await acquireSlot(slotText() + ' (generator preflight)')
    let result
    try {
      result = await runPreflight(o)
    } finally {
      releaseSlot()
    }
    console.log('PREFLIGHT cap ' + result.cap + (result.lowered ? ' (' + result.lowered + ')' : '') + ' slot ' + slot.slot)
    process.exit(result.cap === null ? 3 : 0)
  } else if (cmd === 'run') {
    const o = optionsFromArgs()
    const ladder = await runLadder(o)
    console.log(JSON.stringify(ladder.rungs.map(r => ({ median: r.median, class: r.class, status: r.status }))))
    process.exit(ladder.stoppedAt === null ? 0 : 3)
  } else if (cmd === 'selfcheck') {
    await selfcheckCommand()
  } else if (cmd === 'selfcheck-one') {
    // one tiny ladder (5 characters x 2 chats, 8 modules) with the knobs of this process; the parent reads ladder.json and the rung records
    const o = optionsFromArgs({ rungs: (arg('--rungs', '3')).split(',').map(Number), characters: 5, chats: 2, modules: 8, capMs: Math.round(Number(arg('--cap-min', '1.5')) * 60000) })
    fs.mkdirSync(o.outDir, { recursive: true })
    await runLadder(o)
    process.exit(0)
  } else {
    console.error('commands: run, gen-preflight, selfcheck')
    process.exit(2)
  }
}
//#endregion

//#region self-checks
/** One tiny ladder in a child process (the knobs are read at module load): returns its ladder.json, run.json and rung records. */
async function selfcheckRun(base, id, knobs, { rungs = '3', confirm = false, capMin = '1.5', floor = 2 } = {}) {
  const out = path.join(base, id)
  // a low floor, so that another lane's memory use does not turn a tiny rung into host-floor; T4g sets its own
  const args = [SELF, 'selfcheck-one', '--out', out, '--rungs', rungs, '--cap-min', capMin, '--slot', 'any', '--slot-text', slotText() + ' (self-check ' + id + ')', '--host-free-floor-gib', String(floor)]
  if (confirm) args.push('--confirm-failure')
  const t0 = Date.now()
  const code = await new Promise((resolve) => {
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, env: { ...process.env, C806_FAULT: knobs } })
    live.selfcheckPid = child.pid
    // A wait for a full-run slot is not a stall (another lane may hold both for hours), so the limit is far above any slot wait: a
    // scenario killed while it waited would be NOT RUN, not a result. A tiny ladder that outlives it is ended by its recorded PID.
    const watchdog = setTimeout(() => { killRecorded(child.pid, (cmd) => cmd.includes('c806-import.mjs') && cmd.includes('selfcheck-one')) }, 8 * 60 * 60 * 1000)
    child.on('exit', (c) => { clearTimeout(watchdog); live.selfcheckPid = null; resolve(c) })
  })
  const read = (f) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null)
  const ladder = read(path.join(out, 'ladder.json'))
  const rungsOut = (ladder?.rungs ?? []).map((r) => (r.tag ? read(path.join(out, r.tag, 'rung.json')) : null))
  return { out, code, ms: Date.now() - t0, ladder, rungs: rungsOut }
}

// a hoisted declaration: the main dispatch above runs before this line is evaluated
function squash (s) { return String(s ?? '').replace(/\s+/g, ' ').trim() }

/** en or ko by the page's recorded language; null for any other (a check on app texts is then BLOCKED, not passed). */
function pageLangOf(rung) {
  const l = String(rung?.pageLanguage ?? '')
  return /^ko/i.test(l) ? 'ko' : /^en/i.test(l) ? 'en' : null
}

/** One string literal of the app's own en.ts or ko.ts (the file text is read, not executed), at any indent. */
function appText(key, lang) {
  const src = fs.readFileSync(path.join(REPO_ROOT, 'src', 'lang', lang + '.ts'), 'utf8')
  const m = new RegExp('^\\s*(?:"' + key + '"|' + key + '):\\s*"((?:[^"\\\\\\n]|\\\\.)*)"\\s*,?\\s*$', 'm').exec(src)
  if (m === null) throw new Error('language key not found as a double-quoted literal: ' + lang + ' ' + key)
  return JSON.parse('"' + m[1] + '"')
}

/** Each scenario returns { fails: [...], blocked: [...] } from its run. */
function selfcheckScenarios() {
  const first = (r) => r.rungs[0]
  const textOfFirst = (r) => first(r)?.atFailure?.alertText ?? ''
  return [
    { id: 'T4a-clean', knobs: '', run: { floor: 4 }, check: (r) => {
      const f = []
      const x = first(r)
      if (x?.class !== 'ok') f.push('clean rung class ' + x?.class + ': ' + x?.why)
      if (!x?.figures) f.push('no figures')
      if (x?.census?.againstParams?.equal !== true) f.push('census not equal to params')
      if (r.ladder?.verdict !== 'no breaking point up to rung 3') f.push('verdict ' + r.ladder?.verdict)
      return { fails: f, blocked: [], info: { progressSeen: x?.progressSeen, probeCount: x?.probeCount, confirmsAnswered: x?.confirmsAnswered?.length } }
    } },
    { id: 'T4a-census-mismatch', knobs: 'census-mismatch', run: {}, check: (r) => {
      const x = first(r)
      const f = []
      if (x?.class !== 'page-mismatch') f.push('class ' + x?.class)
      if (x?.figures !== null) f.push('figures kept')
      if (x?.census?.againstParams?.equal !== false) f.push('census equal flag ' + x?.census?.againstParams?.equal)
      return { fails: f, blocked: [] }
    } },
    { id: 'T4b-no-sidecar', knobs: 'no-sidecar', run: {}, check: (r) => {
      const x = first(r)
      const f = []
      if (x?.class !== 'tool' || !/sidecar/.test(x?.why ?? '')) f.push('class ' + x?.class + ' why ' + x?.why)
      return { fails: f, blocked: [] }
    } },
    { id: 'T4c-truncate-bin', knobs: 'truncate-bin', run: {}, check: (r) => {
      const x = first(r)
      const f = []
      if (x?.class !== 'page-error') f.push('class ' + x?.class + ' why ' + x?.why)
      if (x?.atFailure?.alertType !== 'error') f.push('alertType ' + x?.atFailure?.alertType)
      if (!textOfFirst(r)) f.push('no alertText')
      if (!(x?.fileToEndMs < 30000)) f.push('file to end ' + x?.fileToEndMs + ' ms (limit 30000)')
      if (x?.figures !== null) f.push('figures kept')
      return { fails: f, blocked: [] }
    } },
    ...['commit-unknown', 'unit-upload-fail'].map((knob) => ({ id: 'T4u-' + knob, knobs: knob, run: {}, check: (r) => {
      const x = first(r)
      const f = []
      const b = []
      if (x?.faultFetch && x.faultFetch.paused === 0) b.push('the knob paused no request (a service worker answering /api/* ?): ' + JSON.stringify(x.faultFetch))
      // The Welcome screen's restore is the page import: its unknown final write ends on the unconfirmed wait alert (page-unconfirmed)
      // and a failed unit upload on the abandoned error box (page-error). page-blocked belongs to the boot import and fails here.
      // The expected text is the app's own, in the page language; another language cannot be checked and is BLOCKED.
      const lang = pageLangOf(x)
      if (lang === null) b.push('the page language ' + x?.pageLanguage + ' is neither en nor ko: the texts cannot be checked')
      const wantClass = knob === 'commit-unknown' ? 'page-unconfirmed' : 'page-error'
      const wantType = knob === 'commit-unknown' ? 'wait' : 'error'
      if (x?.class !== wantClass) f.push('class ' + x?.class + ' why ' + x?.why + ' (expected ' + wantClass + ')')
      if (x?.atFailure?.alertType !== wantType) f.push('alertType ' + x?.atFailure?.alertType + ' (expected ' + wantType + ')')
      const flags = []
      if (lang !== null) {
        const text = squash(x?.atFailure?.alertText)
        if (knob === 'commit-unknown') {
          if (text !== squash(appText('store2ImportUnconfirmed', lang))) f.push('alertText is not store2ImportUnconfirmed (' + lang + '): ' + text.slice(0, 200))
        } else if (!text.includes(squash(appText('store2ImportAbandoned', lang)))) {
          // another page-error text (for example internalBackupWriteFailed from a failed outcome) is recorded and flagged; the class stands
          flags.push('alertText does not contain store2ImportAbandoned (' + lang + '): ' + text.slice(0, 200))
        }
      }
      if (!(x?.fileToEndMs < 60000)) f.push('file to end ' + x?.fileToEndMs + ' ms (limit 60000)')
      if (knob === 'commit-unknown' ? !(x?.faultFetch?.commitFailed === true && x?.faultFetch?.matched >= 1) : !(x?.faultFetch?.unitFailed === true && x?.faultFetch?.matched >= 1)) f.push('no failed ' + (knob === 'commit-unknown' ? 'commit-key' : 'store2/ unit') + ' write-checked counted: ' + JSON.stringify(x?.faultFetch))
      return { fails: b.length ? [] : f, blocked: b, info: { class: x?.class, alertType: x?.atFailure?.alertType, flags, pageLanguage: x?.pageLanguage, fileToEndMs: x?.fileToEndMs, faultFetch: x?.faultFetch } }
    } })),
    { id: 'T4r-reopen-read-fail', knobs: 'reopen-read-fail', run: {}, check: (r) => {
      const x = first(r)
      const f = []
      const b = []
      const ff = x?.faultFetch
      // zero paused reads after the reload: the interception did not survive the navigation (or never saw it), so nothing was tested
      if (!ff || ff.navigated !== true || !(ff.pausedAfterNavigation > 0)) b.push('no request was paused after the post-import navigation: ' + JSON.stringify(ff))
      const lang = pageLangOf(x)
      if (lang === null) b.push('the page language ' + x?.pageLanguage + ' is neither en nor ko: the heading cannot be checked')
      const premise = []
      // a recovery screen (page-other with a boot surface) is the surface part passing and the label part failing, reported as a premise failure rather than a check failure
      if (x?.class === 'page-other' && x?.atFailure?.alertType === 'boot') premise.push('PREMISE: a boot screen other than the blocked screen ended the rung (recovery?): ' + String(x?.atFailure?.alertText).slice(0, 200))
      else if (x?.class !== 'page-blocked') f.push('class ' + x?.class + ' why ' + x?.why + ' (expected page-blocked)')
      if (x?.class === 'page-blocked') {
        if (x?.atFailure?.alertType !== 'boot') f.push('alertType ' + x?.atFailure?.alertType)
        if (lang !== null && !squash(x?.atFailure?.alertText).includes(squash(appText('blockedTitle', lang)))) f.push('heading is not blockedTitle (' + lang + '): ' + squash(x?.atFailure?.alertText).slice(0, 200))
        if (!x?.atFailure?.blockedReason) f.push('no blockedReason parsed')
      }
      if (!(ff?.readsFailedAfterNavigation >= 1)) f.push('no /api/read failed after the navigation: ' + JSON.stringify(ff))
      const endAt = x?.fileGivenAt != null && x?.fileToEndMs != null ? x.fileGivenAt + x.fileToEndMs : null
      const afterNav = endAt !== null && ff?.navigatedAt ? endAt - ff.navigatedAt : null
      if (!(afterNav !== null && afterNav < 60000)) f.push('end ' + afterNav + ' ms after the navigation (limit 60000)')
      return { fails: b.length ? [] : [...f, ...premise], blocked: b, info: { class: x?.class, alertType: x?.atFailure?.alertType, heading: String(x?.atFailure?.alertText ?? '').slice(0, 200), blockedReason: x?.atFailure?.blockedReason, blockedDetail: x?.atFailure?.blockedDetail, endMsAfterNavigation: afterNav, pageLanguage: x?.pageLanguage, faultFetch: ff } }
    } },
    { id: 'T4d-page-crash', knobs: 'page-crash', run: {}, check: (r) => {
      const x = first(r)
      const f = []
      if (x?.class !== 'renderer-crash') f.push('class ' + x?.class)
      if (!x?.atFailure) f.push('no atFailure')
      if (x?.figures !== null) f.push('figures kept')
      if (!/BREAKING POINT/.test(r.ladder?.verdict ?? '')) f.push('verdict ' + r.ladder?.verdict)
      return { fails: f, blocked: [] }
    } },
    { id: 'T4d-page-crash-confirm', knobs: 'page-crash', run: { confirm: true }, check: (r) => {
      const f = []
      if (r.rungs.length !== 2) f.push('attempts ' + r.rungs.length)
      if (!/^BREAKING POINT at rung 3 \(renderer-crash, renderer-crash\)/.test(r.ladder?.verdict ?? '')) f.push('verdict ' + r.ladder?.verdict)
      return { fails: f, blocked: [] }
    } },
    { id: 'T4d-gen-fail', knobs: 'gen-fail', run: {}, check: (r) => {
      const f = []
      if (r.rungs.length !== 2) f.push('attempts ' + r.rungs.length + ' (one retry expected)')
      if (r.rungs.some((x) => x?.class !== 'tool')) f.push('classes ' + r.rungs.map((x) => x?.class))
      if (!/^UNRESOLVED above rung none \(tool:/.test(r.ladder?.verdict ?? '')) f.push('verdict ' + r.ladder?.verdict)
      return { fails: f, blocked: [] }
    } },
    { id: 'T4e-faulty-chat', knobs: 'faulty-chat', run: {}, check: (r) => {
      const x = first(r)
      const f = []
      if (x?.class !== 'page-refused') f.push('class ' + x?.class + ' why ' + x?.why + ' alert ' + String(x?.atFailure?.alertText ?? '').slice(0, 160))
      if (!(x?.fileToEndMs < 60000)) f.push('file to end ' + x?.fileToEndMs + ' ms (limit 60000)')
      if ((x?.confirmsAnswered ?? []).some((a) => /could not be brought in completely|완전히 가져오지 못했습니다/.test(a.text))) f.push('the incomplete-data confirmation was answered')
      return { fails: f, blocked: [] }
    } },
    { id: 'T4f-census-guard-low', knobs: 'census-guard-low', run: { floor: 1 }, check: (r) => {
      const x = first(r)
      const f = []
      const b = []
      const retry = x?.census?.retry
      if (retry?.skipped) b.push('the census retry was skipped: ' + JSON.stringify(retry))
      else {
        if (x?.class !== 'ok') f.push('class ' + x?.class + ' why ' + x?.why)
        const second = x?.census?.attempts?.[1]
        const m = /--max-old-space-size=(\d+)/.exec(second?.env?.NODE_OPTIONS ?? '')
        if (!m || Number(m[1]) <= 16384 || Number(m[1]) !== retry?.limitMiB) f.push('the retry env did not carry the raised old space: ' + JSON.stringify(second?.env))
      }
      return { fails: b.length ? [] : f, blocked: b }
    } },
    { id: 'T4f-census-guard-always', knobs: 'census-guard-always', run: { rungs: '3,4', floor: 4 }, check: (r) => {
      const f = []
      if (r.rungs.length !== 2) f.push('rungs run ' + r.rungs.length + ' (rung 2 must still run)')
      if (r.rungs.some((x) => x?.class !== 'census-unverified')) f.push('classes ' + r.rungs.map((x) => x?.class))
      if (r.rungs.some((x) => x?.figures === null)) f.push('figures dropped')
      return { fails: f, blocked: [] }
    } },
    { id: 'T4g-floor-high', knobs: 'floor-high,gen-slow', run: {}, check: (r) => {
      const x = first(r)
      const f = []
      if (x?.class !== 'host-floor') f.push('class ' + x?.class)
      if (x?.floor?.tripped?.phase !== 'generator') f.push('phase ' + x?.floor?.tripped?.phase)
      if (x?.generator?.pidGone !== true) f.push('generator pid gone: ' + x?.generator?.pidGone)
      if (!/^UNRESOLVED above rung none \(host floor at rung 3\)/.test(r.ladder?.verdict ?? '')) f.push('verdict ' + r.ladder?.verdict)
      return { fails: f, blocked: [] }
    } },
    { id: 'T4h-hang', knobs: 'hang', run: {}, check: (r) => {
      const f = []
      if (first(r)?.class !== 'cap-alive') f.push('class ' + first(r)?.class)
      if (!/^STALLED at rung 3 \(cap-alive\)/.test(r.ladder?.verdict ?? '')) f.push('verdict ' + r.ladder?.verdict)
      return { fails: f, blocked: [] }
    } },
    { id: 'T4h-freeze', knobs: 'freeze', run: {}, check: (r) => {
      const f = []
      if (first(r)?.class !== 'cap-unresponsive') f.push('class ' + first(r)?.class)
      if (!/^STALLED at rung 3 \(cap-unresponsive\)/.test(r.ladder?.verdict ?? '')) f.push('verdict ' + r.ladder?.verdict)
      return { fails: f, blocked: [] }
    } },
  ]
}

/** T4p: the generator preflight on a tiny library: all rungs pass the first time; a failing top rung lowers the cap. */
async function preflightScenario(base, extraFault) {
  const f = []
  const run = async (id, knobs) => {
    const out = path.join(base, id)
    const args = [SELF, 'gen-preflight', '--out', out, '--rungs', '16,12,10', '--characters', '5', '--chats', '2', '--modules', '8', '--slot', 'any']
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, args, { stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, env: { ...process.env, C806_FAULT: knobs } })
      live.selfcheckPid = child.pid
      child.on('exit', (c) => { live.selfcheckPid = null; resolve(c) })
    })
    const file = path.join(out, 'preflight.json')
    return { code, result: fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null }
  }
  // gen-slow keeps the generator child alive long enough for the one-second PID sampler to read it (a tiny library is done in under a second)
  const clean = await run('T4p-clean', ['gen-slow', extraFault].filter(Boolean).join(','))
  const r0 = clean.result?.rungs?.[0]
  if (clean.result?.cap !== 16) f.push('clean cap ' + clean.result?.cap)
  if (!r0 || r0.exitCode !== 0 || typeof r0.ms !== 'number' || !r0.binBytes || r0.rss?.peakPrivateMiB === null || r0.binDeleted !== true) f.push('preflight record incomplete: ' + JSON.stringify(r0))
  const failing = await run('T4p-fail-16', ['preflight-fail-16', 'gen-slow', extraFault].filter(Boolean).join(','))
  if (failing.result?.cap !== 12) f.push('failing-16 cap ' + failing.result?.cap)
  if (!failing.result?.lowered) f.push('the lowering was not recorded')
  if (failing.result?.rungs?.[0]?.exitCode === 0) f.push('rung 16 did not fail under the knob')
  return { fails: f, blocked: [], info: { cleanCap: clean.result?.cap, failCap: failing.result?.cap, lowered: failing.result?.lowered } }
}

async function selfcheckCommand() {
  const base = scratchPath(arg('--out', path.join(C806_ROOT, 'runs', 'st1', 'selfcheck')))
  fs.mkdirSync(base, { recursive: true })
  const only = (arg('--only') ?? '').split(',').filter(Boolean)
  const extra = arg('--extra-fault') ?? ''
  const results = {}
  const scenarios = selfcheckScenarios().filter((s) => only.length === 0 || only.includes(s.id))
  for (const s of scenarios) {
    const knobs = [s.knobs, extra].filter(Boolean).join(',')
    const r = await selfcheckRun(base, s.id, knobs, s.run)
    // a child that ended without a ladder record (killed, or never past the slot wait) tested nothing
    const verdict = r.ladder === null ? { fails: [], blocked: ['NOT RUN: the scenario left no ladder record (exit ' + r.code + ')'] } : s.check(r)
    results[s.id] = { knobs, status: verdict.blocked.length ? 'BLOCKED' : verdict.fails.length ? 'FAIL' : 'PASS', fails: verdict.fails, blocked: verdict.blocked, info: verdict.info ?? null, out: r.out, ms: r.ms, childExit: r.code }
    console.log('SELFCHECK ' + s.id + ' ' + results[s.id].status + (verdict.fails.length ? ' ' + JSON.stringify(verdict.fails) : '') + (verdict.blocked.length ? ' ' + JSON.stringify(verdict.blocked) : ''))
    fs.writeFileSync(path.join(base, 'selfcheck' + (extra ? '-' + extra : '') + '.json'), JSON.stringify(results, null, 2))
  }
  if (only.length === 0 || only.includes('T4p')) {
    const p = await preflightScenario(base, extra)
    results.T4p = { knobs: extra, status: p.blocked.length ? 'BLOCKED' : p.fails.length ? 'FAIL' : 'PASS', fails: p.fails, blocked: p.blocked, info: p.info }
    console.log('SELFCHECK T4p ' + results.T4p.status + (p.fails.length ? ' ' + JSON.stringify(p.fails) : ''))
    fs.writeFileSync(path.join(base, 'selfcheck' + (extra ? '-' + extra : '') + '.json'), JSON.stringify(results, null, 2))
  }
  const failed = Object.entries(results).filter(([, v]) => v.status === 'FAIL').map(([k]) => k)
  console.log('SELFCHECK-SUMMARY ' + JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.status]))))
  process.exit(failed.length === 0 ? 0 : 1)
}
//#endregion

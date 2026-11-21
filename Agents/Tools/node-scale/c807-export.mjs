// CHORE-807 stage 2 (G1): peak memory and main-thread blocks of a "Save Backup Locally" export of a synthetic library through the real page,
// on the default server writer (SERVER), on the page writer reached through a caps answer without the export flags (PAGE-STREAM), and on
// plain HTTP over the LAN alias (LAN, only on a P0 of reached-home).
//
//   node c807-export.mjs probe-origin [--slot a|b|any] [--slot-text <owner text>] [--out <folder under the scratch root>]
//   node c807-export.mjs export --arm SERVER|PAGE-STREAM|LAN --rung 0.5|6|tiny [--characters 1000] [--chats 20] [--modules 180]
//                               [--cap-min 60] [--keep-bin] [--keep-tree] [--tree-tag <tag>] [--slot ..] [--slot-text ..] [--host-free-floor-gib 8]
//                               [--lan-on-p0 <p0 record json>] [--out <folder>]
//   node c807-export.mjs recheck --run <run folder>   (re-runs the census and the checks on the .bin a run kept; no slot, no browser)
//   node c807-export.mjs selfcheck [--only <id,id>] [--out <folder>]   (T1a-T1f and the mutants; each live scenario is a child run with its own slot hold)
//   node c807-export.mjs pure-checks [--s1-record <run.json>] [--s2-record <run.json>]   (the pure rows: p0Outcome, T1b over run records;
//                                     a T1b row whose record is missing is reported as not run, never as passed)
//
// G1 measurement tooling, diagnostic; no application code. Every number comes from best-case desktop hardware and is not a threshold.
// Invariants:
// - P0 (probe-origin): the page opens at http://mock.test:<port>/ (the launcher's resolver rule maps it to 127.0.0.1), which is not a potentially
//   trustworthy origin. It is informational: p0Outcome gives reached-home, no-sign-in-insecure-origin (only with crypto.subtle absent AND a
//   captured error naming it) or inconclusive. LAN runs only on a P0 of reached-home; otherwise it is recorded as not run, with the outcome named.
// - Arms: SERVER (http://127.0.0.1:<port>, no knob; a Node page whose server advertises exportStream exports through ServerExportWriter),
//   PAGE-STREAM (the same page with knob caps-no-export: a CDP Response-stage Fetch rewrite of /api/caps that removes exactly exportStream
//   and exportStreamVersion, the server's own feature-off body; the page then exports through the streamsaver page writer), LAN
//   (http://mock.test:<port>, server writer). The knob never touches the server process. SEC and SEC-NOHELPER are retired and refused.
//   Which writer ran is judged from the run's own evidence (server reqlog routes), never from the knob's counters; the counters only
//   decide BLOCKED (knob-unseen: no caps read paused after the click).
// - The download goes to a scratch downloadPath through Browser.setDownloadBehavior (allowAndName, events on). If that call fails the export is
//   never started. The user's Downloads folder is never listed.
// - Page ends use c807-pageend.mjs classifyProbe with an export table (exportTable): the answer whitelist is backupConfirm; the notices the
//   tool answers with OK are backupReadyToSave, exportHelperNotResponding and exportHeldInMemory (ko and en); the progress allowlist is the
//   export path's session.gate.wait texts. The web export's progress box carries a Cancel button, and the notices carry OK, which
//   classifyProbe's progress and answer rules do not accept; prepareProbe normalises them first. Any other
//   alert ends the arm at once with its label and text and nothing is clicked.
// - The end is Browser.downloadProgress "completed" together with the phase "export closed".
// - Only PIDs this tool started are killed, by recorded PID after a command-line check. Chrome starts only through launch-chrome.mjs
//   (c806-page.mjs launchChrome). Synthetic seeded data only; the bin census refuses a file outside the run root.
// - SIGINT and SIGTERM: the tool's own handler is registered before the first slot acquire and kills the recorded Chrome, launcher, server,
//   sampler and census child synchronously (each after a command-line check) before the slot's handler releases the slot and exits.
//   The selfcheck parent starts no browser itself; its child runs are in the same console group and clean up through their own handler.
// - run.json records the Chrome version (Browser.getVersion: product, revision, userAgent) and the slot release result.
// - C806_ROOT other than the c807 root is refused.
// Fault knobs (C807_FAULT=<name>[,<name>]), each a defect the self-checks must catch: truncate-download (the kept .bin is cut in half before the
// census), flip-bytes (one byte of the database entry is flipped before the decode; the harness reads the same variable), arm-swap (SERVER runs as
// PAGE-STREAM and the reverse), caps-rewrite-inert (the caps answer is continued unchanged but counted as rewritten), t1b-loose (T1b passes
// any completed download), origin-loopback (P0 opens 127.0.0.1), p0-loose (p0Outcome ignores the error match), no-download-behavior
// (the setDownloadBehavior call is skipped), no-download-guard (the refusal is removed; used together with no-download-behavior),
// drop-backupConfirm (backupConfirm leaves the answer whitelist), alert-blind (the alert surface is not read). Diagnostic knob self-sigint:
// process.emit('SIGINT') once Chrome, the server and the samplers are up (a stand-in for Ctrl-C; it proves the cleanup, not a real console signal).
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SELF = fileURLToPath(import.meta.url)
const DEFAULT_ROOT = path.join(os.tmpdir(), 'risu-b715', 'b61', 'c807')
if (process.env.C806_ROOT !== undefined && path.resolve(process.env.C806_ROOT).toLowerCase() !== path.resolve(DEFAULT_ROOT).toLowerCase()) {
  throw new Error('C806_ROOT must be the c807 run root ' + DEFAULT_ROOT + ', not ' + process.env.C806_ROOT)
}
process.env.C806_ROOT = DEFAULT_ROOT
const FAULTS = new Set((process.env.C807_FAULT ?? '').split(',').map((s) => s.trim()).filter(Boolean))
const MIB = 2 ** 20
const PROBE_EVERY_MS = 700
const SERVER_PORTS = [6860, 6889]
const HELPER_TIMEOUT_MS = 10_000

//#region pure parts (no browser, no files)
const normText = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The three outcomes of P0. Informational: it never decides anything but whether LAN runs. */
export function p0Outcome(ev) {
  if (ev.reachedHome === true) return 'reached-home'
  const subtleAbsent = ev.cryptoSubtle === false
  const namesSubtle = (ev.errors ?? []).some((e) => /subtle|reading '(exportKey|sign|generateKey|importKey|digest)'/.test(String(e)))
  // mutant p0-loose: an absent crypto.subtle alone is taken as the cause
  if (subtleAbsent && (namesSubtle || FAULTS.has('p0-loose'))) return 'no-sign-in-insecure-origin'
  return 'inconclusive'
}

/** One string value of a language file at four spaces of indent, plain or `() =>` form (en.ts writes bare keys, ko.ts quoted ones). */
export function langLiteral(src, key) {
  const re = new RegExp('^    (?:"' + key + '"|' + key + '):\\s*(?:\\(\\)\\s*=>\\s*)?("(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\')\\s*,?\\s*$', 'm')
  const m = re.exec(src)
  if (m === null) throw new Error('language key not found as a string literal: ' + key)
  const lit = m[1]
  return lit.startsWith('"') ? JSON.parse(lit) : JSON.parse('"' + lit.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, '\\"') + '"')
}

/** `backupReadyToSave: () =>\n "..."` spans two lines; the literal is read after the arrow. */
function langArrowLiteral(src, key) {
  const re = new RegExp('(?:"' + key + '"|' + key + '):\\s*\\(\\)\\s*=>\\s*("(?:[^"\\\\\\n]|\\\\.)*")')
  const m = re.exec(src)
  if (m === null) throw new Error('language arrow literal not found: ' + key)
  return JSON.parse(m[1])
}

/**
 * A language value at four spaces of indent as an unanchored pattern: a plain string literal, or the template literal of an
 * arrow (`(a: number, b: number) => \`...\``), whose `${...}` parts match any text.
 */
export function langTemplatePattern(src, key) {
  const re = new RegExp('^    (?:"' + key + '"|' + key + '):\\s*(?:\\([^)\\n]*\\)\\s*=>\\s*)?(`(?:[^`\\\\\\n]|\\\\.)*`|"(?:[^"\\\\\\n]|\\\\.)*"|\'(?:[^\'\\\\\\n]|\\\\.)*\')\\s*,?\\s*$', 'm')
  const m = re.exec(src)
  if (m === null) throw new Error('language key not found as a literal: ' + key)
  const lit = m[1]
  if (!lit.startsWith('`')) return escapeRe(langLiteral(src, key).replace(/\s+/g, ' '))
  return lit.slice(1, -1).split(/\$\{[^}]*\}/).map((part) => escapeRe(part.replace(/\\(.)/g, '$1').replace(/\s+/g, ' '))).join('.*?')
}

// The export path's session.gate.wait texts of backuplocal.ts writeLocalBackup (and its helpers), read from each language source;
// interpolated parts match any text. The asset loop's line may carry the skipped-assets suffix on a second line.
const EXPORT_PROGRESS_SOURCES = [
  { key: 'backupSaveWait', note: 'writeLocalBackup, first wait' },
  { key: 'backupSaveDownloading', note: 'serverExportOpener onProgress' },
  { key: 'backupSaveProgress', suffix: '(?: .*)?', note: 'asset loop' },
  { key: 'backupSaveInlays', note: 'writeInlaysToBackup onProgress' },
  { key: 'backupSaveColdData', note: 'cold payloads, stub payloads, late payloads' },
  { key: 'backupSaveDatabase', note: 'before the database entry' },
]
export const EXPORT_PROGRESS_NOTES = EXPORT_PROGRESS_SOURCES.map((s) => s.note)

/**
 * The page-end table of the export, read from the app's own en.ts and ko.ts text. `faults` is the knob set (drop-backupConfirm).
 * Shape follows c807-pageend.mjs tableFromLangSource for the fields classifyProbe reads; `notices` and `cancelLabels` are the export's own.
 */
export function exportTable(sources, faults = FAULTS) {
  const each = (fn) => sources.map(fn)
  const confirm = each((s) => normText(langLiteral(s, 'backupConfirm')))
  const answerParts = faults.has('drop-backupConfirm') ? [] : confirm
  const noticeTexts = [
    ...each((s) => normText(langArrowLiteral(s, 'backupReadyToSave'))),
    ...each((s) => normText(langLiteral(s, 'exportHelperNotResponding'))),
    ...each((s) => normText(langLiteral(s, 'exportHeldInMemory'))),
  ]
  const cancelLabels = each((s) => normText(langLiteral(s, 'cancel')))
  const okLabels = ['OK', '확인']
  const tail = '(?: (?:' + cancelLabels.map(escapeRe).join('|') + '))?$'
  return {
    answer: answerParts.length ? new RegExp(answerParts.map(escapeRe).join('|')) : /(?!)/,
    errorHeadings: each((s) => normText(langLiteral(s, 'error'))),
    incompletePrefixes: [],
    unconfirmedTexts: [],
    blockedTitles: [],
    detailsHeadings: [],
    progress: EXPORT_PROGRESS_SOURCES.flatMap((p) => each((s) => new RegExp('^' + langTemplatePattern(s, p.key) + (p.suffix ?? '') + tail))),
    notices: noticeTexts.map((t) => new RegExp('^' + escapeRe(t) + '(?: (?:' + okLabels.join('|') + '))?$')),
    noticeTexts,
    cancelLabels,
    okLabels,
    backupConfirmTexts: confirm,
  }
}

/**
 * Splits one probe for classifyProbe: a progress box whose only button is Cancel is shown to it as a buttonless wait; a whitelisted
 * notice whose only button is OK is taken out and returned for the tool to answer. Nothing else is touched.
 */
export function prepareProbe(probe, table) {
  const alerts = []
  const okNotices = []
  for (const a of probe.alerts ?? []) {
    const text = normText(a.text)
    const only = a.buttons.length === 1 ? normText(a.buttons[0]) : null
    if (only !== null && table.cancelLabels.includes(only) && table.progress.some((re) => re.test(text))) { alerts.push({ ...a, buttons: [] }); continue }
    if (only !== null && table.okLabels.includes(only) && table.notices.some((re) => re.test(text))) { okNotices.push(a); continue }
    alerts.push(a)
  }
  return { probe: { ...probe, alerts }, okNotices }
}

/** A server writer route: anchored at the API prefix, so a static chunk with "export" in its name never counts. */
export const isExportRoute = (route) => String(route).startsWith('/api/export/')
const SERVER_WRITER_ROUTES = ['/api/export/begin', '/api/export/append', '/api/export/finalize', '/api/export/download']

/** The checks of the self-check rows, over a run record. Each returns { ok, why } (T1b may return { ok: null, blocked: true, why }). */
export const CHECKS = {
  T1a: (r) => {
    const ok = r.download?.completed === true && r.exportClosed === true && r.census?.equal === true
    return { ok, why: ok ? 'download completed, export closed, census equals the params' : 'download ' + r.download?.completed + ', closed ' + r.exportClosed + ', census ' + JSON.stringify(r.census?.fields ?? r.census?.error ?? null).slice(0, 300) }
  },
  // The writer path must match the arm, judged from the run's own evidence (writerPath, built from the server reqlog and the answered
  // notices). The knob counters decide only BLOCKED: { ok: null, blocked: true } is never a pass.
  T1b: (r) => {
    const w = r.writerPath ?? {}
    // mutant t1b-loose: any completed download passes whatever the arm
    if (FAULTS.has('t1b-loose')) return { ok: r.download?.completed === true, why: 'LOOSE: download completed ' + r.download?.completed }
    const exportRoutes = (w.serverExportRoutes ?? []).filter(isExportRoute)
    const streamsaver = w.streamsaverRequests ?? 0
    if (r.arm === 'SERVER' || r.arm === 'LAN') {
      const missing = SERVER_WRITER_ROUTES.filter((x) => !exportRoutes.includes(x))
      const ok = missing.length === 0 && streamsaver === 0 && w.helperNotice === false && w.path === 'server-export'
      return { ok, why: r.arm + ': missing server routes ' + JSON.stringify(missing) + ', streamsaver requests ' + streamsaver + ', helperNotice ' + w.helperNotice + ', openMs ' + w.openMs + ', path ' + w.path }
    }
    if (r.arm === 'PAGE-STREAM') {
      const after = r.capsFetch?.pausedAfterClick ?? 0
      if (after < 1) return { ok: null, blocked: true, why: 'PAGE-STREAM: knob-unseen, no caps read paused after the click (pausedAfterClick ' + after + ')' }
      const ok = exportRoutes.length === 0 && streamsaver >= 1 && w.helperNotice === false && (w.openMs === null || w.openMs === undefined || w.openMs < HELPER_TIMEOUT_MS) && w.path === 'helper-stream'
      return { ok, why: 'PAGE-STREAM: pausedAfterClick ' + after + ', /api/export/ routes ' + JSON.stringify(exportRoutes) + ', streamsaver requests ' + streamsaver + ', helperNotice ' + w.helperNotice + ', openMs ' + w.openMs + ', path ' + w.path }
    }
    return { ok: false, why: 'unknown arm ' + r.arm }
  },
  T1c: (r) => {
    const fields = ['isSecureContext', 'cryptoSubtle', 'serviceWorker', 'reachedHome', 'errors', 'exceptions', 'consoleErrors', 'proxyRefusals']
    const missing = fields.filter((f) => !(f in (r.p0 ?? {})))
    const outcomeOk = ['reached-home', 'no-sign-in-insecure-origin', 'inconclusive'].includes(r.p0?.outcome)
    const insecure = r.p0?.isSecureContext === false
    const ok = missing.length === 0 && outcomeOk && insecure
    return { ok, why: 'missing ' + JSON.stringify(missing) + ', outcome ' + r.p0?.outcome + ', isSecureContext ' + r.p0?.isSecureContext }
  },
  T1d: (r) => {
    const ok = r.status === 'refused' && r.clickedSave === false && r.refusal === 'download-behavior'
    return { ok, why: 'status ' + r.status + ', clickedSave ' + r.clickedSave + ', refusal ' + r.refusal }
  },
  T1e: (r) => {
    const ok = r.census?.decoder === 'app' && r.census?.equal === true
    return { ok, why: 'decoder ' + r.census?.decoder + ', equal ' + r.census?.equal + ', ' + (r.census?.error ?? '') }
  },
  T1f: (r) => {
    const e = r.pageEnd
    const ok = e?.label === 'page-other' && e?.alertType === 'confirm' && typeof e?.alertText === 'string' && e.alertText.length > 0 && (e.fileToEndMs ?? 1e9) < 10000 && r.clicks?.yes === 0
    return { ok, why: 'label ' + e?.label + ', type ' + e?.alertType + ', ms ' + e?.fileToEndMs + ', yes clicks ' + r.clicks?.yes + ', class ' + r.class }
  },
}

/** The pure rows (no browser): T1c's p0Outcome table. */
export function pureRows() {
  const rows = [
    { name: 'reached-home', ev: { reachedHome: true, cryptoSubtle: false, errors: [] }, want: 'reached-home' },
    { name: 'no subtle and a named error', ev: { reachedHome: false, cryptoSubtle: false, errors: ["TypeError: Cannot read properties of undefined (reading 'importKey')"] }, want: 'no-sign-in-insecure-origin' },
    { name: 'no subtle, no error', ev: { reachedHome: false, cryptoSubtle: false, errors: [] }, want: 'inconclusive' },
    { name: 'subtle present, stalled', ev: { reachedHome: false, cryptoSubtle: true, errors: ["reading 'sign'"] }, want: 'inconclusive' },
    // the boot screen's text as the probe records it (blocked reason, then detail)
    { name: 'no subtle, boot screen text names the call', ev: { reachedHome: false, cryptoSubtle: false, errors: ["boot screen: RisuTanium could not open the data | details: commit-key-unreadable: Cannot read properties of undefined (reading 'generateKey')"] }, want: 'no-sign-in-insecure-origin' },
    { name: 'no subtle, boot screen text names nothing', ev: { reachedHome: false, cryptoSubtle: false, errors: ['boot screen: could not open | details: commit-key-unreadable: disk error'] }, want: 'inconclusive' },
  ]
  return rows.map((r) => ({ name: r.name, got: p0Outcome(r.ev), want: r.want, ok: p0Outcome(r.ev) === r.want }))
}

const verdictOf = (r) => (r.blocked === true ? 'blocked' : r.ok === true ? 'pass' : 'fail')

/**
 * The T1b rows over run records (no browser). Rows (a), (b) and (e) start from the writer evidence of a real SERVER record (`s1Path`, built
 * by the real producer); the capsFetch of rows (b) and (e) is SYNTHETIC, which stays valid because the export-route evidence alone fails
 * PAGE-STREAM. Rows (c) and (d) take a real PAGE-STREAM record (`s2Path`). A row whose record is missing is reported as not run
 * (ok: null, notRun: true), never as passed.
 */
export function t1bPureRows({ s1Path, s2Path }) {
  const rows = []
  const notRun = (name, source, why) => rows.push({ name, source, want: null, got: 'not-run', ok: null, notRun: true, why })
  if (s1Path === null || s1Path === undefined || !fs.existsSync(s1Path)) {
    notRun('(a) real S1 record as SERVER', s1Path ?? null, 'NOT RUN: no S1 record at ' + s1Path)
    notRun('(b) S1 writer evidence as PAGE-STREAM, capsFetch SYNTHETIC (knob fired)', s1Path ?? null, 'NOT RUN: no S1 record at ' + s1Path)
    notRun('(e) PAGE-STREAM with pausedAfterClick 0, capsFetch SYNTHETIC', s1Path ?? null, 'NOT RUN: no S1 record at ' + s1Path)
  }
  const add = (name, rec, want, source) => { const r = CHECKS.T1b(rec); rows.push({ name, source, want, got: verdictOf(r), ok: verdictOf(r) === want, why: r.why }) }
  if (rows.length === 0) {
    const s1 = JSON.parse(fs.readFileSync(s1Path, 'utf8'))
    const real = { download: { completed: s1.download?.completed === true }, writerPath: s1.writerPath }
    const fired = { paused: 1, rewritten: 1, passedUnchanged: 0, pausedAfterClick: 1, rewrittenAfterClick: 1 }
    add('(a) real S1 record as SERVER', { ...real, arm: 'SERVER' }, 'pass', s1Path)
    add('(b) S1 writer evidence as PAGE-STREAM, capsFetch SYNTHETIC (knob fired)', { ...real, arm: 'PAGE-STREAM', capsFetch: fired }, 'fail', s1Path + ' + synthetic capsFetch')
    add('(e) PAGE-STREAM with pausedAfterClick 0, capsFetch SYNTHETIC', { ...real, arm: 'PAGE-STREAM', capsFetch: { ...fired, pausedAfterClick: 0, rewrittenAfterClick: 0 } }, 'blocked', s1Path + ' + synthetic capsFetch')
  }
  if (s2Path !== null && s2Path !== undefined && fs.existsSync(s2Path)) {
    const s2 = JSON.parse(fs.readFileSync(s2Path, 'utf8'))
    add('(c) real S2 record as SERVER', { ...s2, arm: 'SERVER' }, 'fail', s2Path)
    add('(d) real S2 record as PAGE-STREAM', { ...s2, arm: 'PAGE-STREAM' }, 'pass', s2Path)
  } else notRun('(c)/(d) real S2 record', s2Path ?? null, 'NOT RUN: no S2 record (pass --s2-record)')
  return rows
}
//#endregion

//#region imports of the c806 libraries (after the root is set)
const server = await import('./c806-server.mjs')
const page = await import('./c806-page.mjs')
const { commandLineOf, dirsOf, listenable, prepareDist, restoreTree, scratchPath, serverRss, startServer, REPO_ROOT, C806_ROOT } = server
const { attach, closeChrome, launchChrome, mouseClick, readReqlog, reachHome, sleep } = page
const imp = await import('./c806-import.mjs')
const { acquire, LIMIT_NOTE } = await import('./c807-slot.mjs')
const pe = await import('./c807-pageend.mjs')
//#endregion

//#region helpers
const sha256Of = (file) => new Promise((resolve, reject) => {
  const h = createHash('sha256')
  fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
})
const toolHash = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
// a real SERVER record kept under the run root, the writer evidence of T1b-pure rows (a), (b) and (e); absent means those rows are not run
const DEFAULT_S1_RECORD = path.join(C806_ROOT, 'runs', 'st2', 'sc-2', 'S1', 'exp-1794932995400', 'run.json')
const round1 = (x) => Math.round(x * 10) / 10
const mib = (b) => round1(b / MIB)
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d }
const flag = (k) => process.argv.includes(k)
const guarded = (promise, ms, label) => {
  let timer
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out: ' + label)), ms) })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}

function killRecorded(pid, accepts) {
  if (pid === null || pid === undefined) return false
  const cmd = commandLineOf(pid)
  if (cmd === null || !accepts(cmd)) return false
  try { process.kill(pid) } catch { return false }
  return true
}

// The resources of every open run (and of the tree and census children), registered while they live. c807-slot's own SIGINT/SIGTERM handler
// releases the slot and exits right after the listeners registered before it, so this tool's handler is registered before the first acquire
// and ends everything synchronously, each PID after a command-line check; it never kills by image name.
const liveRuns = new Set()
let signalled = false
function killLiveRun(live) {
  killRecorded(live.childPid, (cmd) => cmd.includes('vitest'))
  if (live.h) {
    killRecorded(live.h.chrome, (cmd) => /chrome\.exe/i.test(cmd))
    killRecorded(live.h.launcher, (cmd) => /launch-chrome\.mjs/.test(cmd))
  }
  if (live.server) killRecorded(live.server.pid, (cmd) => cmd.includes('server.cjs'))
  if (live.proc) killRecorded(live.proc.samplerPid, (cmd) => /c806-proc-sampler\.ps1/.test(cmd))
}
function onSignal(signal) {
  if (signalled) return
  signalled = true
  for (const live of liveRuns) {
    try { killLiveRun(live) } catch {}
  }
  // with the slot hooked, its handler follows and exits after releasing; without a slot this handler exits itself
  if (process.listenerCount(signal) <= 1) process.exit(signal === 'SIGINT' ? 130 : 143)
}
function registerSignalHandlers() {
  process.on('SIGINT', () => onSignal('SIGINT'))
  process.on('SIGTERM', () => onSignal('SIGTERM'))
}

function gitText(...args) {
  try { return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).trim() } catch (e) { return 'git failed: ' + e.message }
}

async function pickServerPort() {
  const [lo, hi] = SERVER_PORTS
  const start = lo + Math.floor(Math.random() * (hi - lo + 1))
  for (let i = 0; i <= hi - lo; i++) {
    const p = lo + ((start - lo + i) % (hi - lo + 1))
    if (await listenable(p)) return p
  }
  throw new Error('no free server port in ' + SERVER_PORTS.join('-'))
}

function appLangSources() {
  const read = (name) => fs.readFileSync(path.join(REPO_ROOT, 'src', 'lang', name), 'utf8')
  return [read('en.ts'), read('ko.ts')]
}

/** A browser-level CDP client that also delivers events (the download events come on the browser target). */
async function browserClient(port, onEvent) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const ws = new WebSocket(version.webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('browser websocket failed')) })
  let nextId = 0
  const pending = new Map()
  ws.onmessage = (event) => {
    const m = JSON.parse(event.data)
    if (m.id === undefined) { onEvent(m); return }
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

async function clickSelector(c, selector, textRe = null) {
  const rect = await c.ev(`(() => {
    const re = ${textRe === null ? 'null' : textRe.toString()}
    const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => e.offsetParent && (re === null || re.test((e.innerText || '').trim())))
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (rect === null) return false
  await c.mouse('mouseMoved', rect.x, rect.y)
  await c.mouse('mousePressed', rect.x, rect.y)
  await c.mouse('mouseReleased', rect.x, rect.y)
  return true
}

async function waitFor(c, expression, timeoutMs, label) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    let v = false
    try { v = await c.ev(expression) } catch { v = false }
    if (v) return v
    await sleep(250)
  }
  throw new Error('timed out waiting for ' + label)
}

/** The host-free floor: a parent-side poll of os.freemem() every 500 ms; on a trip `onTrip` ends the active children. */
function startFloor(floorGiB, onTrip) {
  const rec = { floorGiB, floorBytes: floorGiB * 2 ** 30, tripped: null, minFreeBytes: os.freemem(), phase: '' }
  rec.timer = setInterval(() => {
    const free = os.freemem()
    rec.minFreeBytes = Math.min(rec.minFreeBytes, free)
    if (rec.tripped === null && free < rec.floorBytes) {
      rec.tripped = { phase: rec.phase, freeMiB: Math.round(free / MIB), at: new Date().toISOString() }
      try { onTrip(rec) } catch {}
    }
  }, 500)
  rec.end = () => clearInterval(rec.timer)
  return rec
}
//#endregion

//#region the tree (route A) and the census child
function spawnLogged(args, { env, logFile, cwd }) {
  const logFd = fs.openSync(logFile, 'a')
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', logFd, logFd], windowsHide: true })
  const done = new Promise((resolve) => {
    child.on('exit', (code) => { fs.closeSync(logFd); resolve(code) })
    child.on('error', () => { fs.closeSync(logFd); resolve(-1) })
  })
  return { child, done }
}

const VITEST = path.join(REPO_ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const HARNESS_CONFIG = 'Agents/Tools/vitest.harness.config.ts'

/** The pristine route A tree of the parameters, written once and reused; returns { dir, counts, params, reused }. */
async function ensureTree({ treeTag, median, characters, chats, modules, logFile, live }) {
  const treeDir = scratchPath(C806_ROOT, 'data', treeTag, 'pristine')
  const outRoot = scratchPath(C806_ROOT, 'runs', 'trees')
  const treeJson = path.join(outRoot, treeTag, 'tree.json')
  if (fs.existsSync(treeJson) && fs.existsSync(treeDir)) {
    const t = JSON.parse(fs.readFileSync(treeJson, 'utf8'))
    return { dir: treeDir, counts: t.counts, params: t.params, reused: true }
  }
  fs.mkdirSync(outRoot, { recursive: true })
  const env = {
    ...process.env, C806_MODE: 'write', C806_ROUTE: 'A', C806_TAG: treeTag, C806_OUT_ROOT: outRoot, C806_ROOT, C806_SEED: '806',
    C806_CHARACTERS: String(characters), C806_CHATS: String(chats), C806_MEDIAN: String(median), C806_MODULES: String(modules), C806_ARCHIVE: 'on',
    NODE_OPTIONS: '--max-old-space-size=16384',
  }
  delete env.C806_FAULT
  const { child, done } = spawnLogged([VITEST, 'run', '--config', HARNESS_CONFIG, 'Agents/Tools/save-gen/c806-tree.harness.ts'], { env, logFile, cwd: REPO_ROOT })
  live.childPid = child.pid
  const code = await done
  live.childPid = null
  if (code !== 0 || !fs.existsSync(treeJson)) throw new Error('the tree write failed (exit ' + code + '); see ' + logFile)
  const t = JSON.parse(fs.readFileSync(treeJson, 'utf8'))
  return { dir: treeDir, counts: t.counts, params: t.params, reused: false }
}

const COUNT_FIELDS = ['characters', 'chats', 'messages', 'modules', 'enabledModules', 'archiveCharacters']

/** The census of an exported .bin through the application reader (c807-bin-census.harness.ts) against the tree's counts. */
async function binCensus({ bin, counts, outDir, logFile, live, oldSpaceMiB = 16384, floor }) {
  const env = {
    ...process.env, C807_BIN: bin, C807_OUT: outDir, C807_ROOT: C806_ROOT, C806_ROOT, NODE_OPTIONS: '--max-old-space-size=' + oldSpaceMiB,
  }
  const { child, done } = spawnLogged([VITEST, 'run', '--config', HARNESS_CONFIG, 'Agents/Tools/save-gen/c807-bin-census.harness.ts'], { env, logFile, cwd: REPO_ROOT })
  live.childPid = child.pid
  if (floor) floor.phase = 'census'
  const code = await done
  live.childPid = null
  const file = path.join(outDir, 'bin-census.json')
  const out = { exitCode: code, decoder: 'app', reader: 'storeImport createBinImportReader + scanBinForImport + readBinDatabase/decodeBinDatabase + resolveLegacyTree', file, equal: false }
  if (!fs.existsSync(file)) {
    out.error = 'the harness wrote no census (exit ' + code + '); see ' + logFile
    // a harness that could not load its modules is BLOCKED, never replaced by a reader of this tool's own
    const tail = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8').slice(-1500) : ''
    out.blocked = /Failed to (resolve|load) (import|url)|Cannot find module|SyntaxError/.test(tail)
    out.logTail = tail.slice(-600)
    return out
  }
  const c = JSON.parse(fs.readFileSync(file, 'utf8')).census
  out.census = c
  out.fields = Object.fromEntries(COUNT_FIELDS.map((k) => [k, { census: c[k], params: counts[k], equal: c[k] === counts[k] }]))
  out.equal = code === 0 && c.incomplete === 0 && COUNT_FIELDS.every((k) => c[k] === counts[k])
  return out
}
//#endregion

//#region the arm and P0 runs
const ARMS = {
  SERVER: { host: '127.0.0.1', capsKnob: false },
  'PAGE-STREAM': { host: '127.0.0.1', capsKnob: true },
  LAN: { host: 'mock.test', capsKnob: false },
}
const RETIRED_ARMS = ['SEC', 'SEC-NOHELPER']
const swapped = (arm) => (arm === 'SERVER' ? 'PAGE-STREAM' : arm === 'PAGE-STREAM' ? 'SERVER' : arm)

/** An old arm name is refused with the current names, never mapped silently. */
function armConfig(arm) {
  if (RETIRED_ARMS.includes(arm)) throw new Error('arm ' + arm + ' is retired: use SERVER (default server writer), PAGE-STREAM (page writer through the caps-no-export knob) or LAN')
  const cfg = ARMS[FAULTS.has('arm-swap') ? swapped(arm) : arm]
  if (!cfg) throw new Error('unknown arm ' + arm + ' (arms: ' + Object.keys(ARMS).join(', ') + ')')
  return cfg
}

function paramsOf(o) {
  if (o.rung === 'tiny') return { median: 3, characters: 5, chats: 2, modules: 8 }
  return { median: Number(o.rung), characters: o.characters, chats: o.chats, modules: o.modules }
}

function optionsFromArgs() {
  const rung = arg('--rung', 'tiny')
  return {
    arm: arg('--arm', 'SERVER'), rung, characters: Number(arg('--characters', '1000')), chats: Number(arg('--chats', '20')), modules: Number(arg('--modules', '180')),
    capMs: Number(arg('--cap-min', rung === 'tiny' ? '3' : '60')) * 60000, keepBin: flag('--keep-bin'), keepTree: flag('--keep-tree'),
    slot: arg('--slot', 'any'), slotText: arg('--slot-text', 'CHORE-807 S0 stage 2 export'), floorGiB: Number(arg('--host-free-floor-gib', '8')),
    out: arg('--out', path.join(C806_ROOT, 'runs', 'st2', 'live')), treeTag: arg('--tree-tag', null), p0File: arg('--lan-on-p0', null), mode: process.argv[2],
  }
}

/** Opens a run: slot, server, Chrome and the page; returns what a caller needs and an `end()` that stops everything. */
async function openRun(o, tag, { restore, host, switches }) {
  const live = { childPid: null, h: null, server: null, heap: null, phases: null, proc: null, browser: null }
  liveRuns.add(live)
  const rec = { tag, startedAt: new Date().toISOString(), fault: process.env.C807_FAULT || null }
  const runDir = scratchPath(o.out, tag)
  fs.mkdirSync(runDir, { recursive: true })
  rec.runDir = runDir
  const slot = await acquire({ which: o.slot, text: o.slotText })
  rec.slot = { slot: slot.slot, waitedMs: slot.waitedMs, otherAtAcquire: slot.otherAtAcquire, token: slot.token, limit: LIMIT_NOTE }
  const floor = startFloor(o.floorGiB, (f) => {
    killRecorded(live.childPid, (cmd) => cmd.includes('vitest'))
    if (live.h) closeChrome(live.h).catch(() => {})
  })
  const endAll = async () => {
    floor.end()
    for (const step of [() => live.heap?.end(), () => live.phases?.end(), () => live.proc?.end(), () => live.browser?.close(), () => (live.h ? closeChrome(live.h) : null), () => live.server?.stop()]) {
      try { await step() } catch {}
    }
    try { rec.slotRelease = slot.release() } catch {}
    liveRuns.delete(live)
  }
  const ctx = { live, rec, runDir, floor, slot, endAll, tag }
  try {
    if (restore) {
      floor.phase = 'tree'
      const treeTag = o.treeTag ?? ('tree-m' + String(paramsOf(o).median).replace('.', 'p') + '-c' + paramsOf(o).characters + '-h' + paramsOf(o).chats + '-d' + paramsOf(o).modules)
      const p = paramsOf(o)
      ctx.tree = await ensureTree({ treeTag, median: p.median, characters: p.characters, chats: p.chats, modules: p.modules, logFile: path.join(runDir, 'tree.log'), live })
      rec.tree = { tag: treeTag, dir: ctx.tree.dir, reused: ctx.tree.reused, counts: ctx.tree.counts }
    }
    floor.phase = 'server'
    const dist = scratchPath(C806_ROOT, 'build', 'dist')
    if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error('no measurement dist at ' + dist)
    rec.distIndexSha256 = prepareDist(tag, dist)
    const d = dirsOf(tag)
    ctx.d = d
    fs.mkdirSync(d.save, { recursive: true })
    if (restore) rec.restore = restoreTree(tag, ctx.tree.dir)
    for (let attempt = 0; live.server === null; attempt++) {
      const port = await pickServerPort()
      try { live.server = await startServer({ tag, port }) } catch (e) { if (attempt >= 4) throw e; await sleep(1500) }
    }
    rec.server = { pid: live.server.pid, port: live.server.port }
    floor.phase = 'chrome'
    live.h = await launchChrome({ runDir, profileName: tag })
    rec.chrome = { pid: live.h.chrome, cdpPort: live.h.cdpPort }
    const { c, state } = await attach(live.h, { switches })
    try {
      const v = await c.send('Browser.getVersion')
      rec.chromeVersion = { product: v.product, revision: v.revision, userAgent: v.userAgent }
    } catch (e) { rec.chromeVersion = { error: String(e.message).slice(0, 200) } }
    ctx.c = c
    ctx.state = state
    ctx.baseUrl = `http://${host}:${live.server.port}`
    rec.origin = ctx.baseUrl
    return ctx
  } catch (e) {
    ctx.openError = e
    await endAll()
    throw e
  }
}

/** P0: the page at http://mock.test:<port>/ on an empty profile; what the origin allows, and whether sign-in reaches home. */
async function probeOrigin(o, tag = 'p0-' + Date.now()) {
  const host = FAULTS.has('origin-loopback') ? '127.0.0.1' : 'mock.test'
  const ctx = await openRun(o, tag, { restore: false, host, switches: {} })
  const { c, rec, live, floor } = ctx
  const errors = []
  const exceptions = []
  const consoleErrors = []
  try {
    await c.send('Runtime.enable')
    c.on((m) => {
      if (m.method === 'Runtime.exceptionThrown') exceptions.push(String(m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text ?? '').slice(0, 300))
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') consoleErrors.push(m.params.args.map((a) => String(a.value ?? a.description ?? '')).join(' ').slice(0, 300))
    })
    floor.phase = 'p0'
    await c.send('Page.navigate', { url: ctx.baseUrl + '/' })
    let reachedHome = false
    let reachMs = null
    try { const r = await reachHome(c, { timeoutMs: 120000 }); reachedHome = true; reachMs = r.ms } catch (e) { errors.push('reachHome: ' + String(e.message).slice(0, 300)) }
    const env = await guarded(c.ev(`({ isSecureContext: globalThis.isSecureContext === true, cryptoSubtle: !!(globalThis.crypto && globalThis.crypto.subtle), serviceWorker: 'serviceWorker' in navigator, tanium: (globalThis.__risuTaniumErrors || []).map(e => String((e && (e.message || e)) || e)).slice(0, 20), href: location.href })`), 15000, 'p0 env')
    errors.push(...env.tanium, ...exceptions, ...consoleErrors)
    // the boot screen's full text (heading, paragraphs, blocked reason and detail): the reachHome error text is cut at 600 characters
    let bootScreen = null
    let bodyText = null
    if (!reachedHome) {
      try { bootScreen = (await guarded(c.ev(pe.PROBE_EXPRESSION), 15000, 'p0 boot probe')).boot } catch {}
      try { bodyText = await guarded(c.ev(`document.body.innerText.replace(/\\s+/g, ' ').trim().slice(0, 4000)`), 15000, 'p0 body text') } catch {}
      if (bootScreen) errors.push('boot screen: ' + [bootScreen.heading, ...bootScreen.paragraphs, bootScreen.details ?? ''].filter(Boolean).join(' | '))
      else if (bodyText) errors.push('page text: ' + bodyText)
    }
    let launcherTail = ''
    try { launcherTail = fs.readFileSync(path.join(ctx.runDir, 'launcher.log'), 'utf8').slice(-4000) } catch {}
    const proxyRefusals = launcherTail.split('\n').filter((l) => /refus|blocked|denied/i.test(l)).slice(0, 20)
    rec.p0 = { href: env.href, isSecureContext: env.isSecureContext, cryptoSubtle: env.cryptoSubtle, serviceWorker: env.serviceWorker, reachedHome, reachHomeMs: reachMs, bootScreen, bodyText, errors, exceptions, consoleErrors, proxyRefusals }
    rec.p0.outcome = p0Outcome({ reachedHome, cryptoSubtle: env.cryptoSubtle, errors })
    rec.status = 'ok'
  } catch (e) {
    rec.status = 'failed'
    rec.why = String(e.message).slice(0, 600)
  } finally {
    await ctx.endAll()
    fs.writeFileSync(path.join(ctx.runDir, 'run.json'), JSON.stringify(finishRecord(rec), null, 2))
  }
  try { fs.rmSync(ctx.d.save, { recursive: true, force: true }) } catch {}
  return rec
}

function finishRecord(rec) {
  rec.finishedAt = new Date().toISOString()
  rec.provenance = {
    head: gitText('rev-parse', 'HEAD'), statusSrcServer: gitText('status', '--short', '--', 'src', 'server').split('\n').filter(Boolean),
    toolSha256: Object.fromEntries(['c807-export.mjs', 'c807-slot.mjs', 'c807-pageend.mjs', 'c806-import.mjs', 'c806-page.mjs', 'c806-server.mjs'].map((n) => [n, toolHash(path.join(HERE, n))])),
    harnessSha256: toolHash(path.join(REPO_ROOT, 'Agents', 'Tools', 'save-gen', 'c807-bin-census.harness.ts')),
    cpu: os.cpus()[0].model + ' x' + os.cpus().length, ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version, platform: os.platform() + ' ' + os.release(),
    gapVisibilityLimit: LIMIT_NOTE, hardwareCaveat: 'best-case desktop hardware (i9-13900KF, 64 GiB); diagnostic numbers, not thresholds, nothing about phones or a Pi',
    proxyHop: 'every page request goes through the launcher loopback proxy (a Node hop); wall times include it',
    meterSwitches: { 'risu-measure-import': 'on', 'risu-measure-savepass': 'off' },
  }
  return rec
}

const phaseMs = (phases, re) => { const p = phases.find((x) => re.test(x.phase)); return p ? p.t : null }

/** Opens Settings, then Backup & Files; resolves when the Save Backup Locally button shows. */
async function openBackupPage(c, sources, info = {}) {
  const saveRe = new RegExp(sources.map((s) => escapeRe(normText(langLiteral(s, 'saveBackupLocal')))).join('|'))
  const settingsRe = new RegExp('^(' + sources.map((s) => escapeRe(normText(langLiteral(s, 'settings')))).join('|') + ')$')
  const filesRe = new RegExp(sources.map((s) => escapeRe(normText(langLiteral(s, 'backupAndFiles')))).join('|'))
  const shown = (re) => `[...document.querySelectorAll('button')].some(e => e.offsetParent && ${re.toString()}.test((e.innerText || '').trim()))`
  if (!(await c.ev(shown(saveRe)))) {
    if (!(await c.ev(`!!document.querySelector('[data-part=settings-index-entry], [data-part=settings-page]')`))) {
      // Home routes to Settings: the chat shell's footer button (ShellSidebar.svelte data-part sidebar-settings), the legacy rail's
      // Settings button (Sidebar.svelte, no data-part, wide and mid bands), or on the phone band the menu button and the drawer's Settings item
      // (HomeTopBar.svelte data-part home-menu-button, HomeDrawer.svelte data-part home-drawer-item).
      let route = null
      if (await clickSelector(c, '[data-part=sidebar-settings]')) route = 'sidebar-settings'
      else if (await mouseClick(c, settingsRe)) route = 'rail-button'
      // every band: the persona chip opens Settings at the Personas page (HomePersonaChip.svelte onclick openPersonaSettings, homeEmptyActions.ts)
      else if (await clickSelector(c, '[data-part=home-persona-chip]')) route = 'home-persona-chip'
      else if (await clickSelector(c, '[data-part=home-menu-button]')) {
        await waitFor(c, `!!document.querySelector('[data-part=home-drawer-item]')`, 15000, 'the Home drawer')
        if (!(await clickSelector(c, '[data-part=home-drawer-item]', settingsRe))) throw new Error('the Home drawer has no Settings item')
        route = 'home-drawer'
      }
      if (route === null) {
        const snap = await c.ev(`({ innerWidth, layout: (document.querySelector('[data-part=home-landing]') || {}).dataset?.layout ?? null, parts: [...new Set([...document.querySelectorAll('[data-part]')].map(e => e.getAttribute('data-part')))].slice(0, 60), buttons: [...document.querySelectorAll('button')].map(e => ({ t: (e.innerText || '').trim().slice(0, 20), aria: e.getAttribute('aria-label'), title: e.getAttribute('title'), part: e.dataset.part || null, shown: !!e.offsetParent, html: e.outerHTML.slice(0, 160) })).slice(0, 14), body: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 500) })`)
        info.navSnapshot = snap
        throw new Error('no Settings button on the home screen (snapshot in run.json navSnapshot)')
      }
      info.settingsRoute = route
    }
    await waitFor(c, `!!document.querySelector('[data-part=settings-index-entry], [data-part=settings-page]') || ${shown(filesRe)}`, 30000, 'the settings view')
    if (!(await c.ev(shown(saveRe)))) {
      const viaShell = await clickSelector(c, '[data-part=settings-index-entry][data-page=data]')
      if (!viaShell && !(await mouseClick(c, filesRe))) throw new Error('no Backup & Files entry in Settings')
    }
    await waitFor(c, shown(saveRe), 30000, 'the Save Backup Locally button')
  }
  return saveRe
}

/** The export of one arm and rung (or tiny); writes run.json and returns the record. */
async function runExport(o, tag = 'exp-' + Date.now()) {
  const armCfg = armConfig(o.arm)
  const switches = { 'risu-measure-import': 'on', 'risu-measure-savepass': 'off' }
  const sources = appLangSources()
  const table = exportTable(sources)
  const ctx = await openRun(o, tag, { restore: true, host: armCfg.host, switches })
  const { c, rec, live, floor, runDir } = ctx
  rec.arm = o.arm
  rec.armConfig = { ...armCfg, effectiveArm: FAULTS.has('arm-swap') ? swapped(o.arm) : o.arm }
  rec.rung = o.rung
  rec.params = paramsOf(o)
  rec.clicks = { saveButton: 0, yes: 0, ok: 0 }
  rec.clickedSave = false
  rec.confirmsAnswered = []
  rec.noticesAnswered = []
  rec.progressSeen = []
  rec.exportClosed = false
  const downloadPath = path.join(runDir, 'download')
  const dl = { guid: null, filename: null, state: null, totalBytes: null, receivedBytes: null, completedAt: null, beganAt: null }
  // Knob caps-no-export: counts of the Response-stage /api/caps pauses. pausedAfterClick is the knob's proof of reach (the export reads
  // caps once, after its last prompt); the counters never decide which writer ran.
  const capsFetch = { enabled: false, paused: 0, rewritten: 0, passedUnchanged: 0, pausedAfterClick: 0, rewrittenAfterClick: 0, bodyKeys: null, continueApi: null, errors: [] }
  let browser = null
  let importedHome = false
  let clickAt = null
  const noteError = (e) => { if (capsFetch.errors.length < 5) capsFetch.errors.push(String(e?.message ?? e).slice(0, 200)) }
  /** Continues a paused request unchanged; a response-stage pause uses Fetch.continueResponse and falls back to continueRequest. */
  const continuePaused = async (p) => {
    if (p.responseStatusCode === undefined) { await c.send('Fetch.continueRequest', { requestId: p.requestId }); return }
    try { await c.send('Fetch.continueResponse', { requestId: p.requestId }); capsFetch.continueApi ??= 'continueResponse' } catch (e) {
      capsFetch.continueApi ??= 'continueRequest (continueResponse failed: ' + String(e.message).slice(0, 120) + ')'
      await c.send('Fetch.continueRequest', { requestId: p.requestId })
    }
  }
  /** The server's own feature-off body: /api/caps without exactly exportStream and exportStreamVersion. Headers pass through except the framing ones. */
  const answerCaps = async (p) => {
    const after = clickAt !== null
    capsFetch.paused++
    if (after) capsFetch.pausedAfterClick++
    let body = null
    if (p.responseStatusCode >= 200 && p.responseStatusCode < 300) {
      try {
        const got = await c.send('Fetch.getResponseBody', { requestId: p.requestId })
        const parsed = JSON.parse(got.base64Encoded ? Buffer.from(got.body, 'base64').toString('utf8') : got.body)
        if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed
      } catch (e) { noteError(e) }
    }
    if (body === null) { capsFetch.passedUnchanged++; await continuePaused(p); return }
    const counted = () => { capsFetch.rewritten++; if (after) capsFetch.rewrittenAfterClick++ }
    if (FAULTS.has('caps-rewrite-inert')) {
      // mutant caps-rewrite-inert: the body is continued unchanged and still counted as rewritten
      capsFetch.bodyKeys ??= Object.keys(body)
      counted()
      await continuePaused(p)
      return
    }
    delete body.exportStream
    delete body.exportStreamVersion
    capsFetch.bodyKeys ??= Object.keys(body)
    const responseHeaders = (p.responseHeaders ?? []).filter((h) => !/^(content-length|content-encoding|transfer-encoding)$/i.test(h.name))
    await c.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: p.responseStatusCode, responseHeaders, body: Buffer.from(JSON.stringify(body), 'utf8').toString('base64') })
    counted()
  }
  try {
    // every paused request is routed by stage and URL; anything but the caps answer continues unchanged
    c.on((m) => {
      if (m.method !== 'Fetch.requestPaused') return
      const p = m.params
      let isCaps = false
      try { isCaps = new URL(p.request.url).pathname === '/api/caps' } catch {}
      const work = p.responseStatusCode !== undefined && isCaps ? answerCaps(p) : continuePaused(p)
      work.catch(noteError)
    })
    await c.send('Page.navigate', { url: ctx.baseUrl + '/' })
    floor.phase = 'home'
    await guarded(reachHome(c, { timeoutMs: 180000 }), 200000, 'reachHome')
    importedHome = true
    // samplers cover the export window
    live.heap = imp.startHeapSampler(c, path.join(runDir, 'heap.jsonl'))
    live.phases = imp.startPhasePoller(c)
    live.proc = await imp.startProcessSampler({ chromeCdpPort: live.h.cdpPort, serverPid: live.server.pid, dir: runDir, maxSeconds: Math.ceil(o.capMs / 1000) + 600 })
    // diagnostic knob: a process-level SIGINT emitted with Chrome, the server and the samplers up, standing in for Ctrl-C
    if (FAULTS.has('self-sigint')) process.emit('SIGINT')
    // the download goes to a scratch folder; no folder of the user's is touched, and a failed call refuses the export
    fs.mkdirSync(downloadPath, { recursive: true })
    browser = await browserClient(live.h.cdpPort, (m) => {
      if (m.method === 'Browser.downloadWillBegin') { dl.guid = m.params.guid; dl.filename = m.params.suggestedFilename; dl.beganAt = Date.now() }
      if (m.method === 'Browser.downloadProgress') {
        dl.state = m.params.state
        dl.totalBytes = m.params.totalBytes
        dl.receivedBytes = m.params.receivedBytes
        if (m.params.state === 'completed' && dl.completedAt === null) dl.completedAt = Date.now()
      }
    })
    live.browser = browser
    let behaviorSet = false
    if (!FAULTS.has('no-download-behavior')) {
      try { await browser.send('Browser.setDownloadBehavior', { behavior: 'allowAndName', downloadPath, eventsEnabled: true }); behaviorSet = true } catch (e) { rec.downloadBehaviorError = String(e.message).slice(0, 300) }
    }
    rec.downloadBehavior = { set: behaviorSet, downloadPath }
    if (!behaviorSet) {
      if (FAULTS.has('no-download-guard')) {
        // mutant no-download-guard: the refusal is removed. The click is still withheld, so no file can reach the browser's default folder.
        rec.status = 'guard-removed'
        rec.why = 'mutant: the refusal is off and the click is withheld by the harness, never by the tool'
      } else {
        rec.status = 'refused'
        rec.refusal = 'download-behavior'
        rec.why = 'Browser.setDownloadBehavior did not succeed: the export is not started'
      }
      return await finish(null, null, null)
    }
    // the knob is armed after reachHome and before the click; the server and its data are never touched
    if (armCfg.capsKnob) {
      await c.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/caps*', requestStage: 'Response' }] })
      capsFetch.enabled = true
    }
    const saveRe = await openBackupPage(c, sources, rec)
    // the watcher: one probe every 700 ms from the click on
    floor.phase = 'export'
    const state = { end: null, closed: false, helperNotice: false, noticeAt: null, lastClick: 0 }
    const lastNotice = { at: 0 }
    const probeLoop = async () => {
      for (;;) {
        await sleep(PROBE_EVERY_MS)
        if (state.end !== null) return
        let probe = null
        try { probe = await guarded(c.ev(pe.PROBE_EXPRESSION), 8000, 'page probe') } catch { probe = null }
        await live.phases.take()
        if (live.phases.best.some((p) => /^export closed/.test(p.phase))) state.closed = true
        if (state.closed && dl.completedAt !== null) { state.end = { tag: 'done' }; return }
        if (!probe) continue
        if (FAULTS.has('alert-blind')) probe = { ...probe, alerts: [] }
        const prepared = prepareProbe(probe, table)
        for (const a of prepared.okNotices) {
          const text = normText(a.text)
          if (/streamsaver|download helper|helper/i.test(text) || table.noticeTexts.some((t) => text.startsWith(t) && /helper|memory|메모리|도우미/i.test(t))) state.helperNotice = true
          if (Date.now() - lastNotice.at > 1500) {
            lastNotice.at = Date.now()
            if (await mouseClick(c, /^(OK|확인)$/i)) { rec.clicks.ok++; rec.noticesAnswered.push({ afterClickMs: Date.now() - clickAt, text: text.slice(0, 160) }); if (/helper|도우미|memory|메모리/i.test(text)) { state.helperNoticeAt = Date.now() } }
          }
        }
        const decision = pe.classifyProbe(prepared.probe, table)
        if (decision.kind === 'progress') {
          for (const a of prepared.probe.alerts) if (rec.progressSeen.length < 40 && !rec.progressSeen.includes(normText(a.text).slice(0, 80))) rec.progressSeen.push(normText(a.text).slice(0, 80))
        } else if (decision.kind === 'answer') {
          if (Date.now() - state.lastClick > 1500) {
            state.lastClick = Date.now()
            if (await mouseClick(c, /^(예|yes)$/i)) { rec.clicks.yes++; rec.confirmsAnswered.push({ afterClickMs: Date.now() - clickAt, text: probe.alerts.map((a) => a.text).join(' | ').slice(0, 200) }) }
          }
        } else if (decision.kind === 'end') {
          state.end = { tag: 'page-end', decision, probe, at: Date.now() }
          return
        }
      }
    }
    clickAt = Date.now()
    rec.clickAt = clickAt
    rec.clicks.saveButton++
    rec.clickedSave = await clickSelector(c, 'button', saveRe)
    if (!rec.clickedSave) throw new Error('the Save Backup Locally click found no button')
    const crashP = new Promise((resolve) => { const t = setInterval(() => { if (live.h.hasExited()) { clearInterval(t); resolve({ tag: 'chrome-exit' }) } }, 500) })
    const capP = new Promise((resolve) => setTimeout(() => resolve({ tag: 'cap' }), o.capMs))
    const floorP = new Promise((resolve) => { const t = setInterval(() => { if (floor.tripped !== null) { clearInterval(t); resolve({ tag: 'floor' }) } }, 500) })
    const loopP = probeLoop().then(() => state.end ?? { tag: 'loop-ended' })
    const first = await Promise.race([loopP, crashP, capP, floorP])
    state.end ??= first
    const endAt = Date.now()
    rec.endTag = first.tag
    rec.clickToEndMs = endAt - clickAt
    await live.phases.take()
    if (first.tag === 'page-end') {
      rec.pageEnd = { label: first.decision.label, alertType: first.decision.alertType, alertText: first.decision.text, probe: first.probe, fileToEndMs: first.at - clickAt }
    } else if (first.tag === 'cap') {
      try { await guarded(c.send('Runtime.evaluate', { expression: '1' }), 10000, 'cap liveness'); rec.cap = 'cap-alive' } catch { rec.cap = 'cap-unresponsive' }
    }
    rec.exportClosed = state.closed
    rec.helperNoticeSeen = state.helperNotice
    return await finish(first, state, clickAt)
  } catch (e) {
    rec.status = 'failed'
    rec.why = String(e.message).slice(0, 600)
    return await finish(null, null, clickAt)
  }

  async function finish(first, state, clickedAt) {
    const phases = live.phases ? live.phases.best : []
    rec.capsFetch = capsFetch
    rec.download = { ...dl, completed: dl.state === 'completed', downloadPath }
    // stop the samplers and the browser before the analysis
    for (const step of [() => live.heap?.end(), () => live.phases?.end(), () => live.proc?.end(), () => live.browser?.close(), () => closeChrome(live.h), () => live.server?.stop()]) {
      try { await step() } catch {}
    }
    live.heap && (live.heapEnded = true)
    const lines = fs.existsSync(ctx.d.reqlog) ? readReqlog(ctx.d.reqlog) : []
    const heapSamples = live.heap ? live.heap.samples : []
    const procSamples = live.proc ? imp.readProcSamples(live.proc.outFile) : []
    const from = clickedAt ?? 0
    const to = Date.now()
    if (clickedAt !== null) {
      const during = imp.analyseHeap(heapSamples, from, to)
      const proc = live.proc && procSamples.length ? imp.analyseProc(procSamples, live.proc.types, from, to) : null
      const exportPhases = phases.filter((p) => /^export /.test(p.phase)).map((p) => ({ phase: p.phase.slice(0, 120), t: p.t, heapMiB: p.heapMiB ?? null }))
      const heaps = exportPhases.map((p) => p.heapMiB).filter((v) => typeof v === 'number')
      rec.figures = {
        rendererPrivatePeakMiB: proc?.pageRendererGuess?.peakPrivateMiB ?? null,
        browserPrivatePeakMiB: proc?.perPid?.find((p) => p.type === 'browser')?.peakPrivateMiB ?? null,
        peakSumPrivateMiBByType: proc?.peakSumPrivateMiBByType ?? null,
        phaseRingPeakHeapMiB: heaps.length ? Math.max(...heaps) : null,
        cdpHeapPeakBetweenBlocksMiB: during.cdpHeapPeakBetweenBlocksMiB, blocks: during.blocks, maxGapMs: during.maxGapMs,
        clickToCompletedMs: dl.completedAt === null ? null : dl.completedAt - clickedAt,
        phaseDurations: exportPhases.map((p, i) => ({ phase: p.phase, atMs: p.t, sincePreviousMs: i === 0 ? null : p.t - exportPhases[i - 1].t })),
        reqlog: {
          reads: lines.filter((l) => String(l.route).startsWith('/api/read')).length, limited429: lines.filter((l) => l.limited).length,
          total: lines.length, routes: [...new Set(lines.map((l) => String(l.route).startsWith('/api/') ? l.route : 'static'))].slice(0, 40),
        },
      }
      const openedAt = phaseMs(phases, /^export writer opened/)
      const listedAt = phaseMs(phases, /^export listed/)
      const routes = new Set(lines.map((l) => String(l.route)))
      const helperRequests = lines.filter((l) => String(l.route).startsWith('/streamsaver/')).length
      const serverExport = [...routes].some(isExportRoute)
      rec.writerPath = {
        helperNotice: rec.noticesAnswered.some((n) => /helper|도우미|memory|메모리|download helper/i.test(n.text)) || (rec.pageEnd?.alertText ? /helper|memory|도우미|메모리/i.test(rec.pageEnd.alertText) : false),
        openMs: openedAt !== null && listedAt !== null ? openedAt - listedAt : null,
        streamsaverRequests: helperRequests, serverExportRoutes: [...routes].filter(isExportRoute),
        path: serverExport ? 'server-export' : rec.noticesAnswered.some((n) => /helper|도우미/i.test(n.text)) ? 'blob-after-helper-timeout' : helperRequests > 0 ? 'helper-stream' : 'unknown',
        note: 'openMs is the page-side time from "export listed" to "export writer opened"; any prompt answered in between is inside it',
      }
    }
    // the file, its size and sha256; the census through the app's own reader
    let binFile = null
    if (dl.guid !== null && fs.existsSync(path.join(downloadPath, dl.guid))) binFile = path.join(downloadPath, dl.guid)
    else if (fs.existsSync(downloadPath)) { const names = fs.readdirSync(downloadPath); if (names.length === 1) binFile = path.join(downloadPath, names[0]) }
    if (binFile !== null) {
      rec.download.bytes = fs.statSync(binFile).size
      rec.download.sha256 = await sha256Of(binFile)
      rec.download.file = binFile
      // mutant truncate-download: the kept file is cut in half before the census
      if (FAULTS.has('truncate-download') && dl.state === 'completed') { fs.truncateSync(binFile, Math.floor(rec.download.bytes / 2)); rec.download.truncatedBy = 'truncate-download knob' }
      if (rec.download.completed && floor.tripped === null) {
        rec.census = await binCensus({ bin: binFile, counts: ctx.tree.counts, outDir: path.join(runDir, 'bin-census'), logFile: path.join(runDir, 'bin-census.log'), live, floor })
      }
    }
    rec.floor = { floorGiB: floor.floorGiB, tripped: floor.tripped, minFreeMiB: Math.round(floor.minFreeBytes / MIB) }
    rec.class = classifyArm(rec, importedHome)
    if (rec.status === undefined) rec.status = rec.class === 'ok' ? 'ok' : 'failed'
    try { rec.serverRss = serverRss(live.server.pid) } catch {}
    live.heap = live.phases = live.proc = live.browser = null
    try { rec.slotRelease = ctx.slot.release() } catch {}
    liveRuns.delete(live)
    floor.end()
    finishRecord(rec)
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(rec, null, 2))
    if (!o.keepBin && rec.download?.file) { try { fs.rmSync(rec.download.file, { force: true }); rec.download.fileDeleted = true } catch {} }
    try { if (!o.keepTree) fs.rmSync(ctx.d.save, { recursive: true, force: true }) } catch {}
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(rec, null, 2))
    return rec
  }
}

/** The class of one arm: ok only with a completed download, a closed export, a census equal to the params and a writer path that matches the arm. */
function classifyArm(rec, importedHome) {
  if (rec.status === 'refused' || rec.status === 'guard-removed') return rec.status
  if (rec.floor?.tripped) return 'host-floor'
  if (rec.endTag === 'chrome-exit') return 'renderer-crash'
  if (rec.pageEnd) return rec.pageEnd.label
  if (rec.cap) return rec.cap
  if (!importedHome) return 'tool'
  if (rec.census?.blocked) return 'blocked'
  const ok = rec.download?.completed === true && rec.exportClosed === true && rec.census?.equal === true
  if (!ok) return rec.census && rec.census.equal === false && rec.download?.completed ? 'census-mismatch' : 'tool'
  const t1b = CHECKS.T1b(rec)
  if (t1b.blocked) return 'knob-unseen'
  return t1b.ok ? 'ok' : 'writer-path-mismatch'
}
//#endregion

//#region commands
async function recheckCommand() {
  const run = scratchPath(arg('--run'))
  const rec = JSON.parse(fs.readFileSync(path.join(run, 'run.json'), 'utf8'))
  const bin = rec.download?.file
  if (!bin || !fs.existsSync(bin)) throw new Error('the run kept no .bin (use --keep-bin): ' + bin)
  const copy = path.join(run, 'recheck-' + Date.now() + '.bin')
  fs.copyFileSync(bin, copy)
  // the knobs act on the copy, never on the kept file
  if (FAULTS.has('truncate-download')) fs.truncateSync(copy, Math.floor(fs.statSync(copy).size / 2))
  const live = { childPid: null }
  liveRuns.add(live)
  const census = await binCensus({ bin: copy, counts: rec.tree.counts, outDir: path.join(run, 'recheck-census-' + Date.now()), logFile: path.join(run, 'recheck-census.log'), live })
  liveRuns.delete(live)
  try { fs.rmSync(copy, { force: true }) } catch {}
  const out = { ...rec, census, fault: process.env.C807_FAULT || null }
  fs.writeFileSync(path.join(run, 'recheck-' + (process.env.C807_FAULT || 'clean') + '.json'), JSON.stringify(out, null, 2))
  console.log(JSON.stringify({ T1a: CHECKS.T1a(out), T1e: CHECKS.T1e(out) }))
}

const SCENARIOS = [
  { id: 'S1', cmd: ['export', '--arm', 'SERVER', '--rung', 'tiny', '--keep-bin', '--cap-min', '3'], checks: ['T1a', 'T1b', 'T1e'] },
  { id: 'S2', cmd: ['export', '--arm', 'PAGE-STREAM', '--rung', 'tiny', '--cap-min', '3'], checks: ['T1b', 'T1a'] },
  { id: 'S3', cmd: ['probe-origin'], checks: ['T1c'] },
  { id: 'S4', cmd: ['export', '--arm', 'SERVER', '--rung', 'tiny', '--cap-min', '2'], env: { C807_FAULT: 'no-download-behavior' }, checks: ['T1d'] },
  { id: 'S5', cmd: ['export', '--arm', 'SERVER', '--rung', 'tiny', '--cap-min', '2'], env: { C807_FAULT: 'drop-backupConfirm' }, checks: ['T1f'] },
]
const MUTANTS = [
  // arm-swap: the required kill is S1; on S2 the swapped config has no knob, so T1b is BLOCKED (knob-unseen), neither a kill nor a survivor
  { id: 'arm-swap', scenario: 'S1', env: { C807_FAULT: 'arm-swap' }, expectRed: 'T1b' },
  { id: 'arm-swap-s2', scenario: 'S2', env: { C807_FAULT: 'arm-swap' }, expectRed: 'T1b', expectBlocked: true },
  { id: 'caps-rewrite-inert', scenario: 'S2', env: { C807_FAULT: 'caps-rewrite-inert' }, expectRed: 'T1b' },
  { id: 'origin-loopback', scenario: 'S3', env: { C807_FAULT: 'origin-loopback' }, expectRed: 'T1c' },
  { id: 'no-download-guard', scenario: 'S4', env: { C807_FAULT: 'no-download-behavior,no-download-guard' }, expectRed: 'T1d' },
  { id: 'alert-blind', scenario: 'S5', env: { C807_FAULT: 'drop-backupConfirm,alert-blind' }, expectRed: 'T1f', capMin: '1' },
  { id: 'truncate-download', recheck: 'S1', env: { C807_FAULT: 'truncate-download' }, expectRed: 'T1a' },
  { id: 'flip-bytes', recheck: 'S1', env: { C807_FAULT: 'flip-bytes' }, expectRed: 'T1e' },
  { id: 'p0-loose', pure: true, expectRed: 'T1c-pure' },
  { id: 't1b-loose', pure: true, expectRed: 'T1b-pure' },
]

async function runChild(args, env, logFile) {
  const { child, done } = spawnLogged([SELF, ...args], { env: { ...process.env, ...env }, logFile, cwd: REPO_ROOT })
  const code = await done
  return code
}

function latestRunOf(outDir, prefix) {
  if (!fs.existsSync(outDir)) return null
  const names = fs.readdirSync(outDir).filter((n) => n.startsWith(prefix)).sort()
  return names.length ? path.join(outDir, names[names.length - 1]) : null
}

async function selfcheckCommand() {
  const only = (arg('--only') ?? '').split(',').filter(Boolean)
  const out = arg('--out', path.join(C806_ROOT, 'runs', 'st2', 'sc-' + Date.now()))
  fs.mkdirSync(out, { recursive: true })
  const results = []
  const want = (id) => only.length === 0 || only.includes(id)
  // the pure rows: clean, then the p0-loose mutant on the same table
  const clean = pureRows()
  results.push({ id: 'T1c-pure', mutant: null, ok: clean.every((r) => r.ok), why: JSON.stringify(clean.filter((r) => !r.ok)) })
  const kept = {}
  for (const s of SCENARIOS) {
    if (!want(s.id)) continue
    const sub = path.join(out, s.id)
    const code = await runChild([...s.cmd, '--out', sub, '--slot-text', 'CHORE-807 S0 stage 2 self-check ' + s.id], s.env ?? {}, path.join(out, s.id + '.log'))
    const dir = latestRunOf(sub, s.cmd[0] === 'probe-origin' ? 'p0-' : 'exp-')
    const rec = dir && fs.existsSync(path.join(dir, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')) : null
    kept[s.id] = dir
    for (const id of s.checks) {
      if (rec === null) { results.push({ id, scenario: s.id, mutant: null, ok: false, notRun: true, why: 'NOT RUN: no run record (exit ' + code + '); see ' + path.join(out, s.id + '.log') }); continue }
      const r = CHECKS[id](rec)
      results.push({ id, scenario: s.id, mutant: null, ok: r.ok, blocked: r.blocked === true, why: r.why, run: dir })
    }
  }
  // T1b over records: the S1 record (--s1-record or the default), plus rows (c) and (d) from this run's S2 record (or --s2-record)
  const t1bPaths = () => ({ s1Path: arg('--s1-record', DEFAULT_S1_RECORD), s2Path: arg('--s2-record', kept.S2 ? path.join(kept.S2, 'run.json') : null) })
  if (want('T1b-pure')) {
    const rows = t1bPureRows(t1bPaths())
    const failed = rows.some((r) => r.ok === false)
    const unrun = rows.some((r) => r.notRun === true)
    results.push({ id: 'T1b-pure', mutant: null, ok: failed ? false : unrun ? null : true, notRun: !failed && unrun, why: JSON.stringify(rows.map((r) => r.name.slice(0, 3) + ' ' + r.got)) + ' ' + JSON.stringify(rows.filter((r) => !r.ok)) })
  }
  for (const m of MUTANTS) {
    if (!want(m.id)) continue
    if (m.pure) {
      const fault = m.id
      process.env.C807_FAULT = fault
      FAULTS.add(fault)
      const rows = fault === 't1b-loose' ? t1bPureRows(t1bPaths()) : pureRows()
      FAULTS.delete(fault)
      results.push({ id: m.expectRed, mutant: m.id, red: rows.some((r) => r.ok === false), why: JSON.stringify(rows.filter((r) => r.ok === false).map((r) => r.name + ' got ' + r.got + ' want ' + r.want)) })
      continue
    }
    if (m.recheck) {
      const base = kept[m.recheck] ?? latestRunOf(path.join(out, m.recheck), 'exp-')
      if (!base) { results.push({ id: m.expectRed, mutant: m.id, notRun: true, why: 'NOT RUN: scenario ' + m.recheck + ' left no run (needs --keep-bin)' }); continue }
      const code = await runChild(['recheck', '--run', base], m.env, path.join(out, m.id + '.log'))
      const file = path.join(base, 'recheck-' + m.env.C807_FAULT + '.json')
      const rec = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
      const r = rec ? CHECKS[m.expectRed](rec) : { ok: false, why: 'no recheck record (exit ' + code + ')' }
      results.push({ id: m.expectRed, mutant: m.id, red: !r.ok, why: r.why, run: base })
      continue
    }
    const s = SCENARIOS.find((x) => x.id === m.scenario)
    const sub = path.join(out, 'mut-' + m.id)
    const cmd = [...s.cmd]
    if (m.capMin) cmd.splice(cmd.indexOf('--cap-min') + 1, 1, m.capMin)
    const code = await runChild([...cmd, '--out', sub, '--slot-text', 'CHORE-807 S0 stage 2 self-check mutant ' + m.id], m.env, path.join(out, 'mut-' + m.id + '.log'))
    const dir = latestRunOf(sub, s.cmd[0] === 'probe-origin' ? 'p0-' : 'exp-')
    const rec = dir && fs.existsSync(path.join(dir, 'run.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8')) : null
    if (rec === null) { results.push({ id: m.expectRed, mutant: m.id, notRun: true, why: 'NOT RUN: no run record (exit ' + code + ')' }); continue }
    const r = CHECKS[m.expectRed](rec)
    // BLOCKED is neither a kill nor a survivor; it is acceptable only where the row says so
    results.push({ id: m.expectRed, mutant: m.id, red: r.blocked ? (m.expectBlocked ? null : false) : r.ok === false, blocked: r.blocked === true, blockedExpected: r.blocked === true && m.expectBlocked === true, why: r.why, run: dir })
  }
  fs.writeFileSync(path.join(out, 'selfcheck.json'), JSON.stringify(results, null, 2))
  for (const r of results) {
    const verdict = r.mutant
      ? (r.notRun ? 'NOT RUN' : r.blockedExpected ? 'BLOCKED-expected (neither a kill nor a survivor)' : r.blocked ? 'BLOCKED (not a kill)' : r.red ? 'RED (as required)' : 'STILL GREEN (defect of the check)')
      : (r.notRun ? 'NOT RUN' : r.blocked ? 'BLOCKED' : r.ok ? 'PASS' : 'FAIL')
    console.log((r.mutant ? 'MUTANT ' + r.mutant + ' -> ' + r.id : 'CHECK ' + r.id + (r.scenario ? '/' + r.scenario : '')) + ': ' + verdict + ' - ' + String(r.why).slice(0, 300))
  }
  const bad = results.filter((r) => (r.mutant ? r.red === false : r.ok === false && !r.notRun && !r.blocked))
  process.exit(bad.length ? 1 : 0)
}

async function main() {
  const cmd = process.argv[2]
  registerSignalHandlers()
  const o = optionsFromArgs()
  scratchPath(o.out)
  if (cmd === 'probe-origin') {
    const rec = await probeOrigin(o)
    console.log(JSON.stringify({ p0: rec.p0, status: rec.status, runDir: rec.runDir }))
    process.exit(rec.status === 'ok' ? 0 : 1)
  } else if (cmd === 'export') {
    try { armConfig(o.arm) } catch (e) { console.error(e.message); process.exit(2) }
    if (o.arm === 'LAN') {
      if (!o.p0File) { console.error('LAN runs only on a P0 of reached-home: pass --lan-on-p0 <run.json of probe-origin>'); process.exit(2) }
      const p0 = JSON.parse(fs.readFileSync(o.p0File, 'utf8')).p0
      if (p0?.outcome !== 'reached-home') {
        console.log(JSON.stringify({ arm: 'LAN', status: 'not-run', p0Outcome: p0?.outcome ?? null }))
        process.exit(0)
      }
    }
    const rec = await runExport(o)
    console.log(JSON.stringify({ arm: rec.arm, rung: rec.rung, status: rec.status, class: rec.class, runDir: rec.runDir, clickToCompletedMs: rec.figures?.clickToCompletedMs ?? null }))
    process.exit(['ok', 'refused', 'guard-removed'].includes(rec.status) ? 0 : 1)
  } else if (cmd === 'recheck') {
    await recheckCommand()
  } else if (cmd === 'selfcheck') {
    await selfcheckCommand()
  } else if (cmd === 'pure-checks') {
    const rows = [...pureRows(), ...t1bPureRows({ s1Path: arg('--s1-record', DEFAULT_S1_RECORD), s2Path: arg('--s2-record') })]
    console.log(JSON.stringify(rows, null, 1))
    const failed = rows.filter((r) => r.ok === false)
    const unrun = rows.filter((r) => r.notRun === true)
    console.log('PURE-CHECKS: ' + (rows.length - failed.length - unrun.length) + ' ok, ' + failed.length + ' failed, ' + unrun.length + ' NOT RUN' + (unrun.length ? ' (' + unrun.map((r) => r.name.slice(0, 3)).join(' ') + ': no record given or found)' : ''))
    process.exit(failed.length === 0 ? 0 : 1)
  } else {
    console.error('usage: probe-origin | export | recheck | selfcheck | pure-checks (see the header of this file)')
    process.exit(2)
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
//#endregion

// CHORE-807 stage 4 (G3): the server key-scale measurement of the repository's own Node server (server/node/server.cjs). Measurement
// tooling only: no application or server code changes, synthetic data only, diagnostic figures (i9 hardware, no thresholds).
//
//   node c807-keyscale.mjs build  --n <keys> [--tag <t>] [--slot a|b|any]   writes a data dir of N key files (holds a slot)
//   node c807-keyscale.mjs run    --n <keys> [--tag <t>] [--cold 3] [--writes 1000] [--list-reps 5] [--slot a|b|any]   (holds a slot)
//   node c807-keyscale.mjs scenario --name T3a|T3bcde --out <dir> [--slot a|b|any]   one self-check scenario in one slot hold
//   node c807-keyscale.mjs selfcheck [--only <scenario ids, comma separated>]        T3a-T3e clean, then each mutant (a child per scenario)
//
// Data dir (under C806_ROOT, which this tool pins to the c807 run root): data/<tag>/srv/save holds the key files and the revision
// files; data/<tag>/aux holds build.json and a pristine copy of the revision snapshot that every arm restores before it starts.
// Key mix: 90% assets/<64 lowercase hex digits of SHA-256>.<ext> (the form saveAssetFromPieces mints; the extension is at most 16
// alphanumerics, the mix uses 3-4) and 10% store2/g-<16 of 0-9a-v>-<s|u><16 of 0-9a-v> (the staged-key shape of a store2 tree). A
// key file is named lowercase hex of the key's UTF-8 bytes and holds 32 bytes. __revisions.json is JSON.stringify of a map from
// that hex name to revision 1, as compactRevisionsSync writes it. The log arm adds __revisions.log with 20,000 records of
// '\n' + JSON.stringify({ k: <hex name>, r: 2 }), the shape appendRevisionRecords writes; startup then replays and compacts it.
// The longest final path and the longest write-temp path of a build are checked against MAX_PATH and recorded in build.json.
//
// The server is started through c806-server.mjs startServer with NODE_OPTIONS=--require c807-srvprobe.cjs (marks and a gap monitor;
// it changes no response), plain HTTP on 127.0.0.1 in 6800-6899. A "cold start" is a fresh server process on a restored dir; the OS
// file cache is not dropped. Per N: cold starts of the snapshot-only and the snapshot+log dir; 1000 sequential /api/write with
// RISU_REVISION_LOG_COMPACT_AT=1000 (one runtime compaction) with per-write latency and the largest event-loop gap in the compaction
// window; /api/list and /api/list-prefix?prefix=hex('assets/') repeated (the second is the route the export's asset listing uses).
//
// Self-check knobs (C807_FAULT): upper-hex and drop-revision (builder, T3a), drop-key (builder, T3b), no-snapshot (builder, T3c),
// no-compact-env (the write arm omits the compaction env, T3d), lag-blind (the probe's gap monitor is off, T3e). The self-checks run
// the real build and measurement code at 200 and 2,000 keys; they are diagnostics of this tool, not defect reproducers.
//
// Slots: A or B only, through c807-slot.mjs acquire, one hold per build, run or scenario. Servers: only PIDs this process started,
// stopped after a command-line check. The N = 100k / 383k / 1M measurement is a separate, explicitly started run.
import { execFileSync, spawn } from 'node:child_process'
import { createHash, webcrypto } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { acquire, LIMIT_NOTE } from './c807-slot.mjs'

const SELF = fileURLToPath(import.meta.url)
const HERE = path.dirname(SELF)
const PROBE = path.join(HERE, 'c807-srvprobe.cjs')
const RUN_ROOT = path.join(os.tmpdir(), 'risu-b715', 'b61', 'c807')
const OUT_ROOT = path.join(RUN_ROOT, 'runs', 'st4')
if (process.env.C806_ROOT !== undefined && path.resolve(process.env.C806_ROOT).toLowerCase() !== RUN_ROOT.toLowerCase()) {
  throw new Error('C806_ROOT must be the c807 run root ' + RUN_ROOT + ', not ' + process.env.C806_ROOT)
}
process.env.C806_ROOT = RUN_ROOT
delete process.env.RISU_REVISION_LOG_COMPACT_AT
const srv = await import('./c806-server.mjs')

const FAULT = process.env.C807_FAULT ?? ''
const MAX_PATH = 260
const TMP_SUFFIX_CHARS = '.tmp-'.length + 16
const LOG_RECORDS = 20000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const sha = (s) => createHash('sha256').update(s).digest()
const sha256File = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const writeJson = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n')

//#region keys and the data dir builder
const ALPHA = '0123456789abcdefghijklmnopqrstuv'
const EXTS = ['png', 'webp', 'jpg', 'mp3', 'mp4', 'gif', 'json']
const alphaId = (buf, from, length) => {
  let out = ''
  for (let i = 0; i < length; i++) out += ALPHA[buf[from + i] & 31]
  return out
}

export function keyOf(i) {
  const h = sha('c807-key-' + i)
  if (i % 10 !== 9) return 'assets/' + h.toString('hex') + '.' + EXTS[i % EXTS.length]
  const j = (i - 9) / 10
  const stage = alphaId(sha('c807-stg-' + Math.floor(j / 10000)), 0, 16)
  return 'store2/g-' + stage + '-' + (j % 10 === 0 ? 's' : 'u') + alphaId(h, 0, 16)
}
export const hexOf = (key) => Buffer.from(key, 'utf8').toString('hex')
export const bodyOf = (key) => sha('c807-body-' + key)
const isAssetIndex = (i) => i % 10 !== 9

function dirsOf(tag) {
  const d = srv.dirsOf(tag)
  return { ...d, aux: path.join(d.base, 'aux') }
}

function stubDist() {
  const dir = path.join(RUN_ROOT, 'build', 'stubdist')
  fs.mkdirSync(dir, { recursive: true })
  const index = path.join(dir, 'index.html')
  if (!fs.existsSync(index)) fs.writeFileSync(index, '<!doctype html><title>c807 key-scale stub</title>\n')
  return dir
}

function resetData(tag) {
  const d = dirsOf(tag)
  const dataRoot = path.join(RUN_ROOT, 'data')
  if (!/^k[a-z0-9-]{0,24}$/.test(tag)) throw new Error('tag must look like k<name>: ' + tag)
  srv.scratchPath(d.base)
  if (path.dirname(path.resolve(d.base)).toLowerCase() !== dataRoot.toLowerCase()) throw new Error('data dir outside ' + dataRoot)
  fs.rmSync(d.base, { recursive: true, force: true })
  fs.mkdirSync(d.save, { recursive: true })
  fs.mkdirSync(d.aux, { recursive: true })
  srv.prepareDist(tag, stubDist())
  return d
}

/** Writes N key files and the revision snapshot straight into data/<tag>/srv/save. */
export function buildTree({ tag, n, fault = FAULT, log = () => {} }) {
  const t0 = performance.now()
  const d = resetData(tag)
  const revisions = Object.create(null)
  let maxFinal = 0
  let files = 0
  let bytes = 0
  const mix = { assets: 0, store2: 0 }
  for (let i = 0; i < n; i++) {
    if (fault === 'drop-key' && i === 1) continue
    const key = keyOf(i)
    const lower = hexOf(key)
    const name = fault === 'upper-hex' ? lower.toUpperCase() : lower
    const body = bodyOf(key)
    fs.writeFileSync(path.join(d.save, name), body)
    revisions[lower] = 1
    files++
    bytes += body.length
    mix[isAssetIndex(i) ? 'assets' : 'store2']++
    maxFinal = Math.max(maxFinal, d.save.length + 1 + name.length)
    if (i > 0 && i % 100000 === 0) log('built ' + i + ' of ' + n)
  }
  if (fault === 'drop-revision') delete revisions[hexOf(keyOf(2))]
  const snapshot = JSON.stringify(revisions)
  const writeSnapshot = fault !== 'no-snapshot'
  if (writeSnapshot) fs.writeFileSync(path.join(d.save, '__revisions.json'), snapshot)
  fs.writeFileSync(path.join(d.aux, 'revisions.pristine.json'), snapshot)
  const maxTemp = maxFinal + TMP_SUFFIX_CHARS
  const record = {
    tag, n, fault, files, bodyBytes: bytes, mix, snapshotBytes: Buffer.byteLength(snapshot), snapshotWritten: writeSnapshot,
    savePathChars: d.save.length, maxFinalPathChars: maxFinal, maxTempPathChars: maxTemp, maxPath: MAX_PATH,
    pathsUnderMaxPath: maxTemp < MAX_PATH, ms: Math.round(performance.now() - t0),
  }
  writeJson(path.join(d.aux, 'build.json'), record)
  if (!record.pathsUnderMaxPath) throw new Error('the longest write-temp path of this build is ' + maxTemp + ' characters, not under MAX_PATH ' + MAX_PATH)
  return record
}

/** Restores the revision files of one arm: snapshot only (snap) or snapshot plus a 20,000-record log (log). */
function prepareState(tag, n, arm) {
  const d = dirsOf(tag)
  for (const name of ['__revisions.log', '__password', '__known_public_key_hashes.json', '__exports']) {
    fs.rmSync(path.join(d.save, name), { recursive: true, force: true })
  }
  const pristine = path.join(d.aux, 'revisions.pristine.json')
  if (fs.existsSync(pristine) && FAULT !== 'no-snapshot') fs.copyFileSync(pristine, path.join(d.save, '__revisions.json'))
  else fs.rmSync(path.join(d.save, '__revisions.json'), { force: true })
  if (arm === 'log') {
    const step = Math.max(1, Math.floor(n / LOG_RECORDS))
    let text = ''
    for (let j = 0; j < LOG_RECORDS; j++) text += '\n' + JSON.stringify({ k: hexOf(keyOf((j * step) % n)), r: 2 })
    fs.writeFileSync(path.join(d.save, '__revisions.log'), text)
  }
}
//#endregion

//#region server, login, probe events
const live = new Set()
function killLive() {
  for (const s of live) {
    try { s.child.kill() } catch {}
  }
}
process.on('exit', killLive)

async function startProbed(tag, label, runDir, extraEnv = {}) {
  const outFile = path.join(runDir, 'probe-' + label + '.jsonl')
  fs.rmSync(outFile, { force: true })
  const options = [process.env.NODE_OPTIONS, '--require "' + PROBE.replace(/\\/g, '/') + '"'].filter(Boolean).join(' ')
  const s = await srv.startServer({ tag, reqlog: false, env: { NODE_OPTIONS: options, C807_PROBE_OUT: outFile, ...extraEnv } })
  live.add(s)
  return { s, outFile }
}

async function stopServer(s) {
  const cmd = srv.commandLineOf(s.pid)
  if (cmd !== null && !cmd.includes('server.cjs')) throw new Error('refusing to stop pid ' + s.pid + ': not node server.cjs: ' + cmd)
  await s.stop()
  live.delete(s)
}

function readEvents(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
}

const b64u = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')

/** The login of c806-tree.harness.ts loginKey: a fresh ES256 key, the password digest of a synthetic string, a signed JWT per call. */
async function loginClient(baseUrl) {
  const { publicKey, privateKey } = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const pub = await webcrypto.subtle.exportKey('jwk', publicKey)
  const post = async (route, body) => {
    const response = await fetch(baseUrl + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, text: await response.text() }
  }
  const digest = (await post('/api/crypto', { data: 'c807-keyscale-synthetic' })).text
  const set = await post('/api/set_password', { password: digest })
  const login = await post('/api/login', { password: digest, publicKey: pub })
  if (set.status !== 200 || login.status !== 200) throw new Error('login failed: set ' + set.status + ', login ' + login.status)
  return async () => {
    const iat = Math.floor(Date.now() / 1000)
    const head = b64u({ alg: 'ES256', typ: 'JWT' })
    const payload = b64u({ iat, exp: iat + 3000, pub })
    const signature = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, Buffer.from(head + '.' + payload))
    return head + '.' + payload + '.' + Buffer.from(signature).toString('base64url')
  }
}

const statOf = (values) => {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return { count: sorted.length, min: sorted[0], median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] }
}
const round = (x, digits = 2) => (x === null || x === undefined ? null : +x.toFixed(digits))
//#endregion

//#region arms
function startSummary(events, startMs) {
  const first = (name) => events.find((e) => e.ev === name)
  const load = first('load')
  const listening = first('listening')
  const reads = events.filter((e) => e.ev === 'read').map((e) => ({ file: e.file, ms: round(e.ms), bytes: e.bytes }))
  const parses = events.filter((e) => e.ev === 'parse').map((e) => ({ ms: round(e.ms), chars: e.chars, entries: e.entries ?? null }))
  const readdir = first('readdir')
  const compact = events.find((e) => e.ev === 'compact' && e.phase === 'startup')
  const firstGap = events.find((e) => e.ev === 'gap' && e.first)
  const known = reads.reduce((s, r) => s + r.ms, 0) + parses.reduce((s, p) => s + p.ms, 0) + (readdir?.ms ?? 0)
  return {
    startMs, probeLoadedAtMs: round(load?.t), listeningAtMs: round(listening?.t),
    afterLoadToListeningMs: load && listening ? round(listening.t - load.t) : null,
    reads, parses, readdir: readdir ? { ms: round(readdir.ms), count: readdir.count } : null,
    compactStartup: compact ? { ms: round(compact.ms) } : null,
    firstGapMs: round(firstGap?.ms),
    otherMs: load && listening ? round(listening.t - load.t - known - (compact?.ms ?? 0)) : null,
  }
}

async function coldArm({ tag, n, arm, reps, runDir, extraEnv }) {
  const out = []
  for (let rep = 1; rep <= reps; rep++) {
    prepareState(tag, n, arm)
    const { s, outFile } = await startProbed(tag, 'cold-' + arm + '-' + rep, runDir, extraEnv)
    const startMs = s.startMs
    await stopServer(s)
    out.push({ rep, ...startSummary(readEvents(outFile), startMs) })
  }
  return out
}

const overlaps = (aStart, aEnd, bStart, bEnd) => aStart <= bEnd && bStart <= aEnd

async function writesArm({ tag, n, writes, runDir, extraEnv }) {
  prepareState(tag, n, 'snap')
  const env = { ...extraEnv }
  if (FAULT !== 'no-compact-env') env.RISU_REVISION_LOG_COMPACT_AT = '1000'
  const { s, outFile } = await startProbed(tag, 'writes', runDir, env)
  const samples = []
  let retries429 = 0
  try {
    const sign = await loginClient(s.baseUrl)
    const step = Math.max(1, Math.floor(n / writes))
    for (let w = 0; w < writes; w++) {
      const key = keyOf((w * step) % n)
      const body = sha('c807-write-' + key + '-' + w)
      for (let attempt = 0; ; attempt++) {
        const token = await sign()
        const startEpoch = Date.now()
        const t0 = performance.now()
        const response = await fetch(s.baseUrl + '/api/write', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'file-path': hexOf(key), 'risu-auth': token }, body })
        await response.arrayBuffer()
        const ms = performance.now() - t0
        if (response.status === 429 && attempt < 3) {
          retries429++
          await sleep(1100)
          continue
        }
        if (response.status !== 200) throw new Error('write ' + w + ' answered ' + response.status)
        samples.push({ startEpoch, ms })
        break
      }
    }
    const waitUntil = Date.now() + 90000
    while (Date.now() < waitUntil && !readEvents(outFile).some((e) => e.ev === 'compact' && e.phase === 'runtime')) await sleep(250)
  } finally {
    await stopServer(s)
  }
  const events = readEvents(outFile)
  const compact = events.find((e) => e.ev === 'compact' && e.phase === 'runtime')
  const gaps = events.filter((e) => e.ev === 'gap' && !e.first)
  let compaction = null
  if (compact) {
    const endEpoch = compact.epoch
    const startEpoch = endEpoch - compact.ms
    const inside = samples.filter((w) => overlaps(w.startEpoch, w.startEpoch + w.ms, startEpoch, endEpoch))
    const gapsInside = gaps.filter((g) => overlaps(g.epoch - g.ms, g.epoch, startEpoch, endEpoch))
    compaction = {
      windowMs: round(compact.ms), writesOverlapping: inside.length, maxWriteMsOverlapping: round(Math.max(0, ...inside.map((w) => w.ms))),
      maxGapMsInWindow: round(Math.max(0, ...gapsInside.map((g) => g.ms))), gapsInWindow: gapsInside.length,
      writeIndexAtWindowStart: samples.findIndex((w) => w.startEpoch + w.ms >= startEpoch),
    }
  }
  const latency = statOf(samples.map((w) => w.ms))
  return {
    writes: samples.length, retries429, latencyMs: latency && Object.fromEntries(Object.entries(latency).map(([k, v]) => [k, round(v)])),
    runtimeCompactions: events.filter((e) => e.ev === 'compact' && e.phase === 'runtime').length, compaction,
    largestGapMsOverall: round(Math.max(0, ...gaps.map((g) => g.ms))), eldMaxMs: round(Math.max(0, ...events.filter((e) => e.ev === 'eld').map((e) => e.max))),
    cadenceAtDefault: 'At the default of ' + LOG_RECORDS + ' log records a runtime compaction runs after every ' + LOG_RECORDS + ' writes (one record per /api/write); at the measured median of '
      + round(latency?.median) + ' ms per sequential write that is one compaction per ' + round((LOG_RECORDS * (latency?.median ?? 0)) / 1000, 1) + ' s of back-to-back writes. The measured run uses 1000 so one compaction falls inside the run.',
  }
}

async function drain(response) {
  let bytes = 0
  let firstChunkMs = null
  const t0 = performance.now()
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (firstChunkMs === null) firstChunkMs = performance.now() - t0
    bytes += value.length
  }
  return { bytes, firstChunkMs }
}

async function verifyList(baseUrl, token, route, expected) {
  const response = await fetch(baseUrl + route, { headers: { 'risu-auth': token } })
  const body = await response.json()
  if (response.status !== 200 || !Array.isArray(body.content)) return { ok: false, status: response.status }
  const seen = new Set()
  let extra = 0
  for (const name of body.content) {
    if (expected.has(name)) seen.add(name)
    else extra++
  }
  return { ok: true, count: body.content.length, matched: seen.size, missing: expected.size - seen.size, extra }
}

async function listsArm({ tag, n, reps, verify, runDir, extraEnv }) {
  prepareState(tag, n, 'snap')
  const { s, outFile } = await startProbed(tag, 'lists', runDir, extraEnv)
  const routes = [['list', '/api/list'], ['list-prefix', '/api/list-prefix?prefix=' + hexOf('assets/')]]
  const out = { verify: null, routes: {} }
  const windows = []
  try {
    const sign = await loginClient(s.baseUrl)
    if (verify) {
      const all = new Set()
      const assets = new Set()
      for (let i = 0; i < n; i++) {
        const key = keyOf(i)
        all.add(key)
        if (isAssetIndex(i)) assets.add(key)
      }
      out.verify = {
        list: await verifyList(s.baseUrl, await sign(), '/api/list', all),
        listPrefix: await verifyList(s.baseUrl, await sign(), routes[1][1], assets),
        expected: { all: all.size, assets: assets.size },
      }
    }
    for (const [name, route] of routes) {
      const runs = []
      for (let rep = 1; rep <= reps; rep++) {
        const token = await sign()
        const rssBefore = srv.serverRss(s.pid)
        const startEpoch = Date.now()
        const t0 = performance.now()
        const response = await fetch(s.baseUrl + route, { headers: { 'risu-auth': token } })
        const headersMs = performance.now() - t0
        const { bytes, firstChunkMs } = await drain(response)
        const totalMs = performance.now() - t0
        const endEpoch = Date.now()
        const rssAfter = srv.serverRss(s.pid)
        if (response.status !== 200) throw new Error(route + ' answered ' + response.status)
        windows.push({ name, rep, startEpoch, endEpoch })
        runs.push({ rep, headersMs: round(headersMs), firstChunkMs: round(firstChunkMs), totalMs: round(totalMs), bytes, rssBeforeMiB: rssBefore.rssMiB, rssAfterMiB: rssAfter.rssMiB, rssDeltaMiB: round(rssAfter.rssMiB - rssBefore.rssMiB, 1), peakMiB: rssAfter.peakMiB })
      }
      out.routes[name] = { route, runs }
    }
  } finally {
    await stopServer(s)
  }
  const gaps = readEvents(outFile).filter((e) => e.ev === 'gap' && !e.first)
  for (const w of windows) {
    const hit = gaps.filter((g) => overlaps(g.epoch - g.ms, g.epoch, w.startEpoch, w.endEpoch))
    out.routes[w.name].runs[w.rep - 1].maxGapMs = round(Math.max(0, ...hit.map((g) => g.ms)))
  }
  for (const entry of Object.values(out.routes)) {
    const column = (k) => statOf(entry.runs.map((r) => r[k]))
    entry.summary = { headersMs: column('headersMs'), totalMs: column('totalMs'), bytes: column('bytes'), rssDeltaMiB: column('rssDeltaMiB'), maxGapMs: column('maxGapMs') }
  }
  return out
}

async function busyArm({ tag, n, runDir }) {
  prepareState(tag, n, 'snap')
  const { s, outFile } = await startProbed(tag, 'busy', runDir, { C807_PROBE_BUSY_MS: '500' })
  await sleep(4000)
  await stopServer(s)
  const events = readEvents(outFile)
  const listening = events.find((e) => e.ev === 'listening')
  const busy = events.find((e) => e.ev === 'busy')
  const gaps = events.filter((e) => e.ev === 'gap' && !e.first && listening && e.epoch >= listening.epoch)
  return { busyInjected: busy !== undefined, gapsAfterListen: gaps.length, maxGapMs: round(Math.max(0, ...gaps.map((g) => g.ms))) }
}

async function measureOne({ tag, n, cold, writes, listReps, verify, runDir, probeEnv = {}, withBusy = false }) {
  fs.mkdirSync(runDir, { recursive: true })
  const record = { tag, n }
  record.coldSnapshot = await coldArm({ tag, n, arm: 'snap', reps: cold, runDir, extraEnv: probeEnv })
  record.coldLog = await coldArm({ tag, n, arm: 'log', reps: cold, runDir, extraEnv: probeEnv })
  record.writes = await writesArm({ tag, n, writes, runDir, extraEnv: {} })
  record.lists = await listsArm({ tag, n, reps: listReps, verify, runDir, extraEnv: {} })
  if (withBusy) record.busy = await busyArm({ tag, n, runDir })
  return record
}
//#endregion

//#region run records
function gitText(...args) {
  try {
    return execFileSync('git', args, { cwd: path.resolve(HERE, '..', '..', '..'), encoding: 'utf8', windowsHide: true }).trim()
  } catch (e) {
    return 'unavailable: ' + e.message.split('\n')[0]
  }
}

function provenance(extra) {
  return {
    tool: 'c807-keyscale', head: gitText('rev-parse', 'HEAD'), statusSrcServer: gitText('status', '--short', 'src', 'server'),
    toolSha256: { 'c807-keyscale.mjs': sha256File(SELF), 'c807-srvprobe.cjs': sha256File(PROBE) },
    node: process.version, cpu: os.cpus()[0]?.model ?? null, cpuCount: os.cpus().length, totalRamGiB: round(os.totalmem() / 2 ** 30, 1),
    fault: FAULT === '' ? null : FAULT, slotGapLimit: LIMIT_NOTE,
    hardwareCaveat: 'Figures are diagnostic: i9-13900KF-class desktop with a warm OS file cache; no thresholds, not a statement about phones or a Pi.',
    ...extra,
  }
}

function slotInfo(slot) {
  return { slot: slot.slot, waitedMs: slot.waitedMs, token: slot.token, otherAtAcquire: slot.otherAtAcquire }
}
//#endregion

//#region self-check scenarios
function listNames(dir) {
  return fs.readdirSync(dir).filter((name) => !name.startsWith('__')).sort()
}

function recoveredRevisions(dir) {
  const map = Object.create(null)
  const snapshot = path.join(dir, '__revisions.json')
  if (fs.existsSync(snapshot)) for (const [k, r] of Object.entries(JSON.parse(fs.readFileSync(snapshot, 'utf8')))) map[k] = Math.max(map[k] ?? 0, r)
  const logFile = path.join(dir, '__revisions.log')
  if (fs.existsSync(logFile)) {
    for (const line of fs.readFileSync(logFile, 'utf8').split('\n')) {
      if (line === '') continue
      const record = JSON.parse(line)
      if (typeof record.r === 'number') map[record.k] = Math.max(map[record.k] ?? 0, record.r)
    }
  }
  return map
}

/** T3a: the builder dir equals the dir a real server leaves after the same keys went through /api/write. */
async function scenarioT3a(runDir) {
  const n = 200
  const built = buildTree({ tag: 'ksa-b', n })
  const real = resetData('ksa-r')
  const first = await srv.startServer({ tag: 'ksa-r', reqlog: false })
  live.add(first)
  try {
    const sign = await loginClient(first.baseUrl)
    for (let i = 0; i < n; i++) {
      const key = keyOf(i)
      const response = await fetch(first.baseUrl + '/api/write', { method: 'POST', headers: { 'content-type': 'application/octet-stream', 'file-path': hexOf(key), 'risu-auth': await sign() }, body: bodyOf(key) })
      await response.arrayBuffer()
      if (response.status !== 200) throw new Error('real write ' + i + ' answered ' + response.status)
    }
  } finally {
    await stopServer(first)
  }
  const afterWrites = recoveredRevisions(real.save)
  const second = await srv.startServer({ tag: 'ksa-r', reqlog: false })
  live.add(second)
  await stopServer(second)
  const builderDir = dirsOf('ksa-b').save
  const bNames = listNames(builderDir)
  const rNames = listNames(real.save)
  const namesEqual = JSON.stringify(bNames) === JSON.stringify(rNames)
  let bodiesEqual = namesEqual
  if (namesEqual) for (const name of bNames) if (!fs.readFileSync(path.join(builderDir, name)).equals(fs.readFileSync(path.join(real.save, name)))) { bodiesEqual = false; break }
  const sortedEntries = (m) => JSON.stringify(Object.entries(m).sort(([a], [b]) => (a < b ? -1 : 1)))
  const revisionsEqual = sortedEntries(recoveredRevisions(builderDir)) === sortedEntries(afterWrites)
  const bSnap = path.join(builderDir, '__revisions.json')
  const rSnap = path.join(real.save, '__revisions.json')
  const snapshotBytesEqual = fs.existsSync(bSnap) && fs.existsSync(rSnap) && fs.readFileSync(bSnap).equals(fs.readFileSync(rSnap))
  const pass = namesEqual && bodiesEqual && revisionsEqual && snapshotBytesEqual
  return {
    T3a: { pass, namesEqual, bodiesEqual, revisionsEqual, snapshotBytesEqual, builderFiles: bNames.length, realFiles: rNames.length, built, revisionEntriesReal: Object.keys(afterWrites).length },
  }
}

/** T3b-T3e on the 2,000-key fixture. */
async function scenarioT3bcde(runDir) {
  const n = 2000
  const built = buildTree({ tag: 'ksb-2000', n })
  const record = await measureOne({
    tag: 'ksb-2000', n, cold: 1, writes: 1000, listReps: 2, verify: true, runDir, withBusy: true,
    probeEnv: { C807_PROBE_PARSE_MIN: '100000', C807_PROBE_COUNT: '1' },
  })
  const v = record.lists.verify
  const snapStart = record.coldSnapshot[0]
  const snapRead = snapStart.reads.find((r) => r.file === '__revisions.json')
  const parseWindow = snapStart.parses.find((p) => p.entries === n)
  const compaction = record.writes.compaction
  const T3b = { pass: v?.list?.ok === true && v.list.count === n && v.list.missing === 0 && v.list.extra === 0 && v.listPrefix.ok === true && v.listPrefix.count === v.expected.assets && v.listPrefix.missing === 0 && v.listPrefix.extra === 0, verify: v }
  const T3c = { pass: snapRead !== undefined && snapRead.bytes > 0 && snapStart.listeningAtMs !== null && parseWindow !== undefined && snapStart.readdir?.count >= n, snapshotRead: snapRead ?? null, parseWindow: parseWindow ?? null, readdir: snapStart.readdir }
  const T3d = { pass: record.writes.writes === 1000 && compaction !== null && compaction.windowMs > 0 && record.writes.runtimeCompactions === 1, compaction, runtimeCompactions: record.writes.runtimeCompactions }
  const T3e = { pass: record.busy.busyInjected && record.busy.maxGapMs >= 450, busy: record.busy }
  writeJson(path.join(runDir, 'measure.json'), { built, record })
  return { T3b, T3c, T3d, T3e }
}

async function scenarioCommand(argv) {
  const o = flagsOf(argv)
  const name = o.name
  if (name !== 'T3a' && name !== 'T3bcde') throw new Error('scenario name must be T3a or T3bcde')
  const runDir = path.resolve(o.out ?? path.join(OUT_ROOT, 'scenario-' + name + '-' + Date.now()))
  srv.scratchPath(runDir)
  fs.mkdirSync(runDir, { recursive: true })
  writeJson(path.join(runDir, 'status.json'), { name, fault: FAULT || null, status: 'WAITING FOR A SLOT', at: new Date().toISOString() })
  const slot = await acquire({ which: o.slot ?? 'any', text: 'CHORE-807 S0 stage 4 selfcheck ' + name + (FAULT ? ' ' + FAULT : '') })
  const startedAt = new Date().toISOString()
  writeJson(path.join(runDir, 'status.json'), { name, fault: FAULT || null, status: 'RUNNING', slot: slot.slot, at: startedAt })
  let checks
  let error = null
  try {
    checks = name === 'T3a' ? await scenarioT3a(runDir) : await scenarioT3bcde(runDir)
  } catch (e) {
    error = e.stack ?? String(e)
    checks = {}
  } finally {
    killLive()
  }
  const released = slot.release()
  const result = { name, fault: FAULT || null, startedAt, endedAt: new Date().toISOString(), slot: slotInfo(slot), released: released.removed, otherAtRelease: released.otherAtRelease, error, checks, ...provenance({}) }
  writeJson(path.join(runDir, 'result.json'), result)
  writeJson(path.join(runDir, 'status.json'), { name, fault: FAULT || null, status: error ? 'ERROR' : 'DONE', slot: slot.slot, at: result.endedAt })
  for (const [id, c] of Object.entries(checks)) console.log((c.pass ? 'PASS ' : 'FAIL ') + id)
  if (error) console.log('ERROR ' + error)
  return error === null && Object.values(checks).every((c) => c.pass) ? 0 : 1
}

const SCENARIOS = [
  { id: 'T3a-clean', name: 'T3a', fault: '', red: null },
  { id: 'T3a-upper-hex', name: 'T3a', fault: 'upper-hex', red: 'T3a' },
  { id: 'T3a-drop-revision', name: 'T3a', fault: 'drop-revision', red: 'T3a' },
  { id: 'T3bcde-clean', name: 'T3bcde', fault: '', red: null },
  { id: 'T3b-drop-key', name: 'T3bcde', fault: 'drop-key', red: 'T3b' },
  { id: 'T3c-no-snapshot', name: 'T3bcde', fault: 'no-snapshot', red: 'T3c' },
  { id: 'T3d-no-compact-env', name: 'T3bcde', fault: 'no-compact-env', red: 'T3d' },
  { id: 'T3e-lag-blind', name: 'T3bcde', fault: 'lag-blind', red: 'T3e' },
]

async function selfcheckCommand(argv) {
  const o = flagsOf(argv)
  const only = o.only ? o.only.split(',') : null
  const dir = path.join(OUT_ROOT, 'selfcheck-' + Date.now())
  fs.mkdirSync(dir, { recursive: true })
  const before = { keyscale: sha256File(SELF), probe: sha256File(PROBE), status: gitText('status', '--short', 'src', 'server') }
  const rows = []
  for (const sc of SCENARIOS) {
    if (only && !only.includes(sc.id)) continue
    const runDir = path.join(dir, sc.id)
    fs.mkdirSync(runDir, { recursive: true })
    const log = fs.openSync(path.join(runDir, 'child.log'), 'w')
    const env = { ...process.env }
    delete env.C807_FAULT
    if (sc.fault) env.C807_FAULT = sc.fault
    console.log('scenario ' + sc.id + ' started ' + new Date().toISOString())
    const code = await new Promise((resolve) => {
      const child = spawn(process.execPath, [SELF, 'scenario', '--name', sc.name, '--out', runDir], { env, stdio: ['ignore', log, log], windowsHide: true })
      child.on('exit', (c) => resolve(c ?? 1))
    })
    fs.closeSync(log)
    const resultFile = path.join(runDir, 'result.json')
    const result = fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null
    const pick = (id) => (result?.checks?.[id] ? (result.checks[id].pass ? 'PASS' : 'FAIL') : 'n/a')
    const row = {
      id: sc.id, fault: sc.fault || null, exit: code, expectedRed: sc.red, slot: result?.slot?.slot ?? null, waitedMs: result?.slot?.waitedMs ?? null,
      error: result?.error ?? (result ? null : 'no result.json (killed or not run)'),
      checks: Object.fromEntries(['T3a', 'T3b', 'T3c', 'T3d', 'T3e'].filter((id) => result?.checks?.[id]).map((id) => [id, pick(id)])),
      dir: runDir,
    }
    row.ok = result !== null && row.error === null && (sc.red === null ? Object.values(row.checks).every((v) => v === 'PASS') : row.checks[sc.red] === 'FAIL')
    rows.push(row)
    console.log('scenario ' + sc.id + ': exit ' + code + ', ' + JSON.stringify(row.checks) + (row.ok ? ' as expected' : ' NOT AS EXPECTED'))
  }
  const after = { keyscale: sha256File(SELF), probe: sha256File(PROBE), status: gitText('status', '--short', 'src', 'server') }
  const summary = { before, after, filesUnchanged: before.keyscale === after.keyscale && before.probe === after.probe, srcServerClean: before.status === '' && after.status === '', rows, allAsExpected: rows.every((r) => r.ok) }
  writeJson(path.join(dir, 'summary.json'), summary)
  console.log('summary ' + path.join(dir, 'summary.json'))
  console.log(summary.allAsExpected && summary.filesUnchanged && summary.srcServerClean ? 'SELFCHECK OK' : 'SELFCHECK NOT OK')
  return summary.allAsExpected ? 0 : 1
}
//#endregion

//#region build and run commands
async function buildCommand(argv) {
  const o = flagsOf(argv)
  const n = Number(o.n)
  if (!Number.isSafeInteger(n) || n < 10) throw new Error('--n must be an integer of at least 10')
  const tag = o.tag ?? 'k' + n
  const slot = await acquire({ which: o.slot ?? 'any', text: 'CHORE-807 S0 stage 4 data dir build n=' + n })
  console.log('slot ' + slot.slot + ' acquired after ' + slot.waitedMs + ' ms')
  try {
    const record = buildTree({ tag, n, log: console.log })
    console.log(JSON.stringify(record))
    return 0
  } finally {
    slot.release()
  }
}

async function runCommand(argv) {
  const o = flagsOf(argv)
  const n = Number(o.n)
  const tag = o.tag ?? 'k' + n
  const d = dirsOf(tag)
  const buildFile = path.join(d.aux, 'build.json')
  if (!fs.existsSync(buildFile)) throw new Error('no build for ' + tag + '; run build first')
  const built = JSON.parse(fs.readFileSync(buildFile, 'utf8'))
  if (built.n !== n || built.fault !== '' && built.fault !== null && built.fault !== undefined) throw new Error('the build of ' + tag + ' does not match n=' + n + ' or was made with a fault knob')
  srv.prepareDist(tag, stubDist())
  const runDir = path.join(OUT_ROOT, 'run-' + tag + '-' + Date.now())
  fs.mkdirSync(runDir, { recursive: true })
  const slot = await acquire({ which: o.slot ?? 'any', text: 'CHORE-807 S0 stage 4 key-scale run n=' + n })
  console.log('slot ' + slot.slot + ' acquired after ' + slot.waitedMs + ' ms; run folder ' + runDir)
  writeJson(path.join(runDir, 'run.json'), provenance({ status: 'RUNNING', params: { n, tag }, slot: slotInfo(slot), built }))
  let record
  try {
    record = await measureOne({ tag, n, cold: Number(o.cold ?? 3), writes: Number(o.writes ?? 1000), listReps: Number(o['list-reps'] ?? 5), verify: n <= 1000000, runDir })
  } finally {
    killLive()
    const released = slot.release()
    writeJson(path.join(runDir, 'run.json'), provenance({ status: record ? 'DONE' : 'FAILED', params: { n, tag }, slot: slotInfo(slot), otherAtRelease: released.otherAtRelease, built }))
  }
  writeJson(path.join(runDir, 'result.json'), record)
  console.log('result ' + path.join(runDir, 'result.json'))
  return 0
}
//#endregion

function flagsOf(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error('unexpected argument: ' + argv[i])
    o[argv[i].slice(2)] = argv[++i]
  }
  return o
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'build') return buildCommand(rest)
  if (command === 'run') return runCommand(rest)
  if (command === 'scenario') return scenarioCommand(rest)
  if (command === 'selfcheck') return selfcheckCommand(rest)
  console.error('usage: c807-keyscale.mjs build|run|scenario|selfcheck (see the header)')
  return 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main().then((code) => process.exit(code), (e) => {
    console.error(e.stack ?? e.message)
    process.exit(1)
  })
}

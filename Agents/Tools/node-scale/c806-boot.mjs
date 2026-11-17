// CHORE-806 stage 2: boot timing of a synthetic store2 tree on the self-hosted Node server, through the real page.
//
//   node c806-boot.mjs run --arm <tree tag, e.g. scale-on> [--label <name>] [--boots 5] [--settle-ms 5000] [--boot-timeout-ms 600000]
//
//   node c806-boot.mjs arms --arms scale-on,scale-off-250 [--boots 5] [--pause-ms 90000]
//
// One run is one arm (one tree) and holds the full-run slot (%TEMP%\risu-b715\fullrun-slot) for its whole length. `arms` runs
// several arms in one process: it releases the slot after each arm and waits --pause-ms (default 90 s) before it tries again,
// so a queued lane can take the slot between two arms. Separate `run` invocations release it between arms. Sequence: one untimed setup boot (the sign-in of a fresh profile), N cache-cleared boots,
// one untimed priming load with the cache on, N warm boots.
// Invariants:
// - Every boot starts from a restored pristine tree (restoreTree keeps only the login files), a freshly started server on the
//   same port (the page origin and its IndexedDB keypair stay), and a page parked on about:blank, so no earlier boot's save
//   pass or half-finished request reaches the next one. The commit key hash is recorded after the restore and after the boot.
// - A "cold" boot here is a boot with the HTTP cache cleared and disabled. The registered service worker and Cache Storage
//   survive that, so each boot records their state and its navigation count; it is not a cold-cache boot in the browser sense.
// - The meters stay off: risu-measure-savepass and risu-measure-import are set to off by a script added before any page script.
//   A save pass during the boot is therefore detected from the request log (commit writes), not from the meter.
// - Ready means the home screen (or a reopened chat) showed, stamped inside the page by a mutation observer on the epoch clock,
//   so it is not quantised by this tool's polling. Request log times come from the same machine's epoch clock.
// - A boot that crashes the renderer or does not reach ready in the boot timeout ends the arm: the result says so and the
//   caller stops the larger sizes of that arm family.
// - Only PIDs this tool started are killed (server, chrome, launcher), through the c806-page and c806-server helpers.
// Fault knobs (scratch self-checks): C806_FAULT=drop-log (the request log loses every second line), early-ready (ready is
// stamped at the first mutation), arm-swap (the archive expectation of the arm is inverted).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { C806_ROOT, REPO_ROOT, commitKeyHash, dirsOf, prepareDist, restoreTree, scratchPath, serverRss, startServer, listenable, pickFreePort } from './c806-server.mjs'
import { attach, closeChrome, fillPasswordPrompt, launchChrome, readReqlog, sleep, findByName, openLibrary } from './c806-page.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SLOT = path.join(os.tmpdir(), 'risu-b715', 'fullrun-slot')
let FAULT = process.env.C806_FAULT ?? ''

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
//#endregion

//#region helpers
function guarded(promise, ms, label) {
  let timer
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timed out: ' + label)), ms) })
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer))
}

const median = (xs) => {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const stat = (xs) => xs.length === 0 ? null : { n: xs.length, median: median(xs), min: Math.min(...xs), max: Math.max(...xs) }

const sha256File = (file) => createHash('sha256').update(fs.readFileSync(file)).digest('hex')

function gitText(...args) {
  try { return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).trim() } catch (e) { return 'git failed: ' + e.message }
}

/** Runs inside the page, before its own scripts: stamps the first prompt and the first ready screen on the epoch clock. */
function readyObserverInPage(early) {
  const state = { readyAt: null, readyKind: null, promptAt: null }
  window.__c806Boot = state
  const stamp = () => performance.timeOrigin + performance.now()
  const check = () => {
    if (state.promptAt === null && document.querySelector('#alert-input')) state.promptAt = stamp()
    if (state.readyAt === null) {
      if (early) { state.readyAt = stamp(); state.readyKind = 'early-fault'; return }
      if (document.querySelector('[data-part=home-landing]')) { state.readyAt = stamp(); state.readyKind = 'home' }
      else if (document.querySelector('[data-part=chat-messages]')) { state.readyAt = stamp(); state.readyKind = 'chat' }
    }
  }
  new MutationObserver(check).observe(document, { childList: true, subtree: true })
}

/** Maps the census of an arm to key -> unit type (character rows only); other keys fall back to their kind letter. */
function loadTypeMap(censusFile) {
  const census = JSON.parse(fs.readFileSync(censusFile, 'utf8')).census
  const map = new Map()
  for (const row of census.characters.rows) for (const k of row.keys) map.set(k.key, k.type)
  return { map, archive: census.configArchiveCharacters, manifestKey: census.manifestKey, byType: census.byType }
}

function typeOfKey(key, typeMap) {
  const known = typeMap.get(key)
  if (known) return known
  if (key === 'store2-commit' || key === 'store2-fence' || key === 'store2-sweep') return key
  const m = /^store2\/g-[^-]+-([a-z])/.exec(key)
  if (m) return m[1] === 'm' ? 'manifest' : m[1] === 's' ? 'shard' : 'unit-untyped'
  return 'other'
}

async function waitPortFree(port, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await listenable(port)) return true
    await sleep(200)
  }
  return false
}
//#endregion

//#region one boot
function aggregateReqlog(lines, typeMap, tNav, tReady, tEnd) {
  const inWindow = lines.filter(l => l.t0 >= tNav && l.t0 <= tEnd)
  const out = { total: inWindow.length, byRoute: {}, bySignature: {}, keysByType: {}, unattributedKeys: 0, limited429: 0, aborted: 0, commitWrites: [], writes: {}, reads: { firstT0: null, lastT1: null, count: 0, afterReady: 0, inFlightAtReady: 0 } }
  for (const l of inWindow) {
    const route = l.route.startsWith('/api/') ? l.route : 'static'
    const r = out.byRoute[route] ??= { count: 0, inBytes: 0, outBytes: 0, status: {} }
    r.count++; r.inBytes += l.inBytes; r.outBytes += l.outBytes; r.status[l.status] = (r.status[l.status] ?? 0) + 1
    if (l.limited) out.limited429++
    if (l.aborted) out.aborted++
    let sig
    if (Array.isArray(l.keys)) {
      const types = new Set(l.keys.map(k => typeOfKey(k, typeMap)))
      for (const k of l.keys) { const t = typeOfKey(k, typeMap); out.keysByType[t] = (out.keysByType[t] ?? 0) + 1 }
      sig = route + ' ' + [...types].sort().join('+')
    } else {
      out.unattributedKeys += l.keyCount
      sig = route + ' (' + Object.keys(l.classes).sort().join('+') + ', over 64 keys)'
    }
    const s = out.bySignature[sig] ??= { count: 0, keys: 0, inBytes: 0, outBytes: 0 }
    s.count++; s.keys += l.keyCount; s.inBytes += l.inBytes; s.outBytes += l.outBytes
    if (l.method === 'POST' && l.classes['store2-commit']) out.commitWrites.push({ t0: l.t0, ifMatch: l.ifMatch, status: l.status, afterReadyMs: tReady === null ? null : Math.round(l.t0 - tReady) })
    if (l.route === '/api/write' || l.route === '/api/write-checked') {
      const w = out.writes[l.route] ??= { total: 0, afterReady: 0 }
      w.total++
      if (tReady !== null && l.t0 > tReady) w.afterReady++
    }
    if (l.method === 'GET' && l.route === '/api/read') {
      const rd = out.reads
      rd.count++
      rd.firstT0 = rd.firstT0 === null ? l.t0 : Math.min(rd.firstT0, l.t0)
      rd.lastT1 = rd.lastT1 === null ? l.t1 : Math.max(rd.lastT1, l.t1)
      if (tReady !== null && l.t0 > tReady) rd.afterReady++
      else if (tReady !== null) {
        rd.beforeReady = (rd.beforeReady ?? 0) + 1
        rd.lastT1BeforeReady = Math.max(rd.lastT1BeforeReady ?? 0, l.t1)
      }
      if (tReady !== null && l.t0 <= tReady && l.t1 > tReady) rd.inFlightAtReady++
    }
  }
  const rdb = out.reads
  rdb.beforeReadyWindowMs = rdb.lastT1BeforeReady === undefined || rdb.firstT0 === null ? null : Math.round(Math.min(rdb.lastT1BeforeReady, tReady) - rdb.firstT0)
  rdb.lastBeforeReadyAfterNavMs = rdb.lastT1BeforeReady === undefined ? null : Math.round(rdb.lastT1BeforeReady - tNav)
  out.reads.windowMs = out.reads.firstT0 === null ? null : Math.round(out.reads.lastT1 - out.reads.firstT0)
  out.reads.firstAfterNavMs = out.reads.firstT0 === null ? null : Math.round(out.reads.firstT0 - tNav)
  out.reads.lastAfterNavMs = out.reads.lastT1 === null ? null : Math.round(out.reads.lastT1 - tNav)
  return out
}

function aggregateCdp(requests) {
  const out = { total: 0, byRoute: {}, fromServiceWorker: 0, fromCache: 0, failed: 0 }
  for (const r of requests.values()) {
    const pathname = new URL(r.url).pathname
    const route = pathname.startsWith('/api/') ? pathname : 'static'
    const g = out.byRoute[route] ??= { count: 0, unanswered: 0, encodedBytes: 0, dataBytes: 0, status: {} }
    // a request that failed before any answer never reached the server, so it is not part of the count that the request log is compared with
    if (r.status === null && r.failed) { g.unanswered++; out.failed++; continue }
    out.total++
    g.count++; g.encodedBytes += r.enc; g.dataBytes += r.data
    if (r.status !== null) g.status[r.status] = (g.status[r.status] ?? 0) + 1
    if (r.fromSW) out.fromServiceWorker++
    if (r.fromCache) out.fromCache++
  }
  return out
}

/**
 * One boot. kind: setup | cold | prime | warm. The page is parked on about:blank at entry and at exit.
 * Returns the boot record; `crashed` and `timedOut` end the arm.
 */
async function bootOnce(ctx, kind, index) {
  const { c, h, state, d, port, treeDir, typeMap, expected, settleMs, bootTimeoutMs, runDir, cdp } = ctx
  const rec = { kind, index, excluded: kind === 'setup' || kind === 'prime' }
  // restore the pristine tree, then start the server on the same port
  rec.restore = restoreTree(ctx.tag, treeDir)
  rec.commitHashBefore = commitKeyHash(d.save)
  rec.pristineHash = ctx.pristineHash
  rec.hashBeforeEqualsPristine = rec.commitHashBefore === ctx.pristineHash
  // the page origin (and its stored keypair) is bound to this port, so the same port is kept; another lane's server may take it
  // between two boots, so a start that fails is retried for a while before the arm gives up
  let server = null
  for (let attempt = 0; server === null; attempt++) {
    if (!(await waitPortFree(port))) { if (attempt >= 20) throw new Error('the port did not free: ' + port); continue }
    try { server = await startServer({ tag: ctx.tag, port }) } catch (e) {
      if (attempt >= 20) throw e
      rec.serverStartRetries = (rec.serverStartRetries ?? 0) + 1
      await sleep(3000)
    }
  }
  ctx.server = server
  rec.serverPid = server.pid
  rec.serverIdentity = 'nonce and listener pid verified'
  const refusalsFile = path.join(runDir, 'proxy-refusals.jsonl')
  const refusalsBefore = fs.existsSync(refusalsFile) ? fs.readFileSync(refusalsFile, 'utf8').split('\n').filter(Boolean).length : 0
  // cold: cache cleared and disabled; every other kind runs with the cache on
  await c.send('Network.setCacheDisabled', { cacheDisabled: kind === 'cold' })
  if (kind === 'cold') await c.send('Network.clearBrowserCache')
  state.navigations = 0
  const cur = { requests: new Map(), crashed: false, closed: false }
  cdp.cur = cur
  const tNav = Date.now()
  await c.send('Page.navigate', { url: server.baseUrl + '/' })
  // wait for ready, answering the sign-in prompt whenever it shows; heap sampled alongside
  let readyAt = null
  let readyKind = null
  let promptAt = null
  let prompts = 0
  let lastAnswer = 0
  let peakHeap = 0
  let samples = 0
  let heapGapMaxMs = 0
  let lastSampleAt = Date.now()
  while (Date.now() - tNav < bootTimeoutMs) {
    if (cur.crashed) break
    let st = null
    try { st = await guarded(c.ev('({ b: window.__c806Boot ?? null, prompt: !!document.querySelector("#alert-input") })'), 15000, 'ready poll') } catch (e) { st = null }
    if (st && st.b && st.b.readyAt !== null) { readyAt = st.b.readyAt; readyKind = st.b.readyKind; promptAt = st.b.promptAt; break }
    if (st && st.prompt && Date.now() - lastAnswer > 3000) {
      prompts++
      lastAnswer = Date.now()
      try { await guarded(fillPasswordPrompt(c), 15000, 'sign-in prompt') } catch {}
    }
    try {
      const u = await guarded(c.send('Runtime.getHeapUsage'), 15000, 'heap sample')
      peakHeap = Math.max(peakHeap, u.usedSize)
      samples++
      const now = Date.now()
      heapGapMaxMs = Math.max(heapGapMaxMs, now - lastSampleAt)
      lastSampleAt = now
    } catch {}
    await sleep(400)
  }
  rec.crashed = cur.crashed
  rec.timedOut = readyAt === null && !cur.crashed
  rec.navigations = state.navigations
  rec.prompts = prompts
  rec.readyKind = readyKind
  rec.readyMs = readyAt === null ? null : Math.round(readyAt - tNav)
  rec.firstPromptAfterNavMs = promptAt === null ? null : Math.round(promptAt - tNav)
  rec.peakSampledHeapUsed = peakHeap
  rec.heapSamples = samples
  rec.heapSampleMaxGapMs = heapGapMaxMs
  if (readyAt !== null) {
    // settle: five seconds after ready, counted from the ready stamp
    const waitMs = readyAt + settleMs - Date.now()
    if (waitMs > 0) await sleep(waitMs)
  }
  const tEnd = Date.now()
  cur.closed = true
  rec.cdp = aggregateCdp(cur.requests)
  rec.settleMs = settleMs
  if (rec.crashed || rec.timedOut) {
    rec.reqlog = null
  } else {
    // after the window: collect, measure the heap, and read the page's own timing and cache state
    try {
      await guarded(c.send('HeapProfiler.enable'), 15000, 'HeapProfiler.enable')
      rec.heapUsageBeforeGc = await guarded(c.send('Runtime.getHeapUsage'), 15000, 'heap before gc')
      await guarded(c.send('HeapProfiler.collectGarbage'), 120000, 'collectGarbage')
      rec.heapUsageAfterGc = await guarded(c.send('Runtime.getHeapUsage'), 15000, 'heap after gc')
      await c.send('Performance.enable')
      const metrics = await guarded(c.send('Performance.getMetrics'), 15000, 'Performance.getMetrics')
      rec.performanceMetrics = Object.fromEntries(metrics.metrics.map(m => [m.name, m.value]))
    } catch (e) { rec.heapError = String(e.message) }
    try {
      rec.pageState = await guarded(c.ev(`(async () => {
        const nav = performance.getEntriesByType('navigation')[0]
        const regs = await navigator.serviceWorker.getRegistrations()
        const names = await caches.keys()
        const counts = {}
        for (const n of names) counts[n] = (await (await caches.open(n)).keys()).length
        return {
          navigation: nav ? nav.toJSON() : null,
          serviceWorkerRegistrations: regs.length,
          serviceWorkerController: !!navigator.serviceWorker.controller,
          cacheNames: names, cacheEntryCounts: counts,
          readyAt: window.__c806Boot ? window.__c806Boot.readyKind : null,
          savePassMeter: typeof globalThis.__risuSavePassMeter,
        }
      })()`), 30000, 'page state')
    } catch (e) { rec.pageStateError = String(e.message) }
    const lines = readReqlog(d.reqlog)
    const kept = FAULT === 'drop-log' ? lines.filter((_, i) => i % 2 === 0) : lines
    rec.reqlog = aggregateReqlog(kept, typeMap, tNav, readyAt, tEnd)
    rec.reqlogLinesTotal = lines.length
    try { rec.serverRss = serverRss(server.pid) } catch (e) { rec.serverRssError = String(e.message) }
    // the last character's name must be searchable once ready (a ready stamp that comes early fails this)
    try {
      await openLibrary(c)
      rec.lastNameSearchable = await findByName(c, expected.lastName, 30000)
    } catch (e) { rec.lastNameSearchable = false; rec.searchError = String(e.message).slice(0, 200) }
    // the arm's expectation about character cores: archive on reads none at boot, archive off reads all of them
    const coreReads = rec.reqlog.keysByType.characterCore ?? 0
    const archive = FAULT === 'arm-swap' ? !typeMap.archive : typeMap.archive
    rec.characterCoreReads = coreReads
    rec.armExpectationHolds = archive ? coreReads === 0 : coreReads >= ctx.characters
  }
  rec.limited429 = rec.reqlog ? rec.reqlog.limited429 : null
  rec.limiterBound = !!rec.limited429
  rec.proxyRefusals = (fs.existsSync(refusalsFile) ? fs.readFileSync(refusalsFile, 'utf8').split('\n').filter(Boolean).length : 0) - refusalsBefore
  // park the page, stop the server, hash the commit key again
  if (!rec.crashed) {
    try { await guarded(c.send('Page.navigate', { url: 'about:blank' }), 20000, 'park page'); await sleep(1500) } catch (e) { rec.parkError = String(e.message) }
  }
  await server.stop()
  ctx.server = null
  rec.commitHashAfter = commitKeyHash(d.save)
  rec.commitHashChanged = rec.commitHashAfter !== rec.commitHashBefore
  const keep = path.join(runDir, `reqlog-${kind}-${index}.jsonl`)
  if (fs.existsSync(d.reqlog)) fs.copyFileSync(d.reqlog, keep)
  return rec
}
//#endregion

//#region arm
async function runArm({ arm, label, boots, settleMs, bootTimeoutMs, slotWaitedMs }) {
  const tag = 'b-' + arm + '-' + Date.now()
  const treeDir = scratchPath(C806_ROOT, 'data', arm, 'pristine')
  const treeJson = JSON.parse(fs.readFileSync(path.join(C806_ROOT, 'runs', 'stage1', arm, 'tree.json'), 'utf8'))
  const censusFile = path.join(C806_ROOT, 'runs', 'stage1', arm + '-census', 'census.json')
  const dist = scratchPath(C806_ROOT, 'build', 'dist')
  const runDir = scratchPath(C806_ROOT, 'runs', 'stage2', tag)
  fs.mkdirSync(runDir, { recursive: true })
  const run = { tag, arm, label: label ?? arm, startedAt: new Date().toISOString(), slotWaitedMs, params: treeJson.params, counts: treeJson.counts, fault: FAULT || null }
  const lib = await import(pathToFileURL(path.join(REPO_ROOT, 'Agents', 'Tools', 'save-gen', 'c806-library.mjs')).href)
  const p = lib.normalizeParams(treeJson.params)
  const lastName = lib.buildCharacter(p, p.characters - 1).name
  const { map: typeMap, archive: archiveFlag } = loadTypeMap(censusFile)
  typeMap.archive = archiveFlag
  const pristineHash = commitKeyHash(treeDir)
  const switches = { 'risu-measure-savepass': 'off', 'risu-measure-import': 'off' }
  run.provenance = {
    head: gitText('rev-parse', 'HEAD'), statusToolsAndSrc: gitText('status', '--short', '--', 'Agents/Tools', 'src').split('\n').filter(Boolean),
    toolSha256: Object.fromEntries(['c806-boot.mjs', 'c806-page.mjs', 'c806-server.mjs', 'c806-reqlog.cjs'].map(f => [f, sha256File(path.join(HERE, f))])),
    distIndexSha256: prepareDist(tag, dist), pristineTree: treeDir, pristineCommitKeyHash: pristineHash, pristineFiles: treeJson.tree.files,
    cpu: os.cpus()[0].model + ' x' + os.cpus().length, ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version, platform: os.platform() + ' ' + os.release(),
    meterSwitches: switches,
    proxyHop: 'every page request goes through the launcher loopback proxy (a Node hop); wall times include it',
    hardwareCaveat: 'best-case desktop hardware (i9 class); diagnostic numbers, not thresholds, nothing about phones or a Pi',
    coldMeaning: 'HTTP cache cleared and disabled; the registered service worker and Cache Storage survive (state recorded per boot)',
  }
  const d = dirsOf(tag)
  const ctx = { tag, d, treeDir, typeMap, expected: { lastName }, settleMs, bootTimeoutMs, runDir, pristineHash, characters: p.characters, cdp: { cur: null }, server: null }
  let h = null
  const records = []
  let stopArm = null
  const cleanup = async () => {
    if (ctx.server) { try { await ctx.server.stop() } catch {} ctx.server = null }
    if (h) { run.closed = await closeChrome(h); h = null }
  }
  const onSignal = () => { cleanup().finally(() => { releaseSlot(); process.exit(130) }) }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    // restore once and start the first server before Chrome, so the port is chosen once and kept
    restoreTree(tag, treeDir)
    // a port from the upper part of the range keeps clear of other lanes' servers, which start from the bottom
    const first = await startServer({ tag, port: await pickFreePort(6860 + Math.floor(Math.random() * 30)) })
    ctx.port = first.port
    await first.stop()
    h = await launchChrome({ runDir, profileName: tag })
    ctx.h = h
    const { c, state } = await attach(h, { switches })
    ctx.c = c
    ctx.state = state
    await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${readyObserverInPage.toString()})(${FAULT === 'early-ready' ? 'true' : 'false'})` })
    c.on((m) => {
      const cur = ctx.cdp.cur
      if (m.method === 'Inspector.targetCrashed' && cur) cur.crashed = true
      if (!cur || cur.closed) return
      const q = m.params
      if (m.method === 'Network.requestWillBeSent') cur.requests.set(q.requestId, { url: q.request.url, enc: 0, data: 0, status: null, fromSW: false, fromCache: false, failed: false })
      else if (m.method === 'Network.responseReceived') { const r = cur.requests.get(q.requestId); if (r) { r.status = q.response.status; r.fromSW = !!q.response.fromServiceWorker; r.fromCache = !!q.response.fromDiskCache } }
      else if (m.method === 'Network.dataReceived') { const r = cur.requests.get(q.requestId); if (r) r.data += q.dataLength }
      else if (m.method === 'Network.loadingFinished') { const r = cur.requests.get(q.requestId); if (r) r.enc = q.encodedDataLength }
      else if (m.method === 'Network.loadingFailed') { const r = cur.requests.get(q.requestId); if (r) r.failed = true }
    })
    run.chromeVersion = (await c.send('Browser.getVersion')).product
    run.pids = { chrome: h.chrome, launcher: h.launcher, cdpPort: h.cdpPort, serverPort: ctx.port }
    const plan = [['setup', 0], ...Array.from({ length: boots }, (_, i) => ['cold', i + 1]), ['prime', 0], ...Array.from({ length: boots }, (_, i) => ['warm', i + 1])]
    for (const [kind, index] of plan) {
      const rec = await bootOnce(ctx, kind, index)
      records.push(rec)
      console.log(JSON.stringify({ kind, index, readyMs: rec.readyMs, navigations: rec.navigations, prompts: rec.prompts, crashed: rec.crashed, timedOut: rec.timedOut, limited429: rec.limited429, reads: rec.reqlog?.reads.count }))
      fs.writeFileSync(path.join(runDir, 'boots.json'), JSON.stringify(records, null, 2))
      if (rec.crashed || rec.timedOut) { stopArm = (rec.crashed ? 'renderer crash' : 'no ready within ' + bootTimeoutMs + ' ms') + ' at ' + kind + ' ' + index; break }
      if (rec.readyMs !== null && rec.readyMs > bootTimeoutMs) { stopArm = 'ready later than the boot timeout at ' + kind + ' ' + index; break }
    }
  } catch (e) {
    run.error = String(e.stack ?? e).slice(0, 2000)
  } finally {
    await cleanup()
    run.pristineCommitKeyHashAtEnd = commitKeyHash(treeDir)
    run.pristineUnchanged = run.pristineCommitKeyHashAtEnd === pristineHash
    run.finishedAt = new Date().toISOString()
    run.stopArm = stopArm
    run.stopLargerSizes = stopArm !== null
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2))
    fs.writeFileSync(path.join(runDir, 'boots.json'), JSON.stringify(records, null, 2))
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
  const summary = summarise(records)
  const checks = checksOf(records, run)
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2))
  fs.writeFileSync(path.join(runDir, 'checks.json'), JSON.stringify(checks, null, 2))
  fs.writeFileSync(path.join(runDir, 'table.md'), tableOf(run, summary, checks))
  console.log(tableOf(run, summary, checks))
  console.log('run folder ' + runDir)
  return { runDir, run, summary, checks }
}
//#endregion

//#region summary and checks
const METRICS = {
  readyMs: (r) => r.readyMs,
  readWindowMs: (r) => r.reqlog?.reads.windowMs ?? null,
  readsBeforeReady: (r) => r.reqlog?.reads.beforeReady ?? null,
  readsAfterReady: (r) => r.reqlog?.reads.afterReady ?? null,
  lastReadBeforeReadyAfterNavMs: (r) => r.reqlog?.reads.lastBeforeReadyAfterNavMs ?? null,
  firstReadAfterNavMs: (r) => r.reqlog?.reads.firstAfterNavMs ?? null,
  lastReadAfterNavMs: (r) => r.reqlog?.reads.lastAfterNavMs ?? null,
  navigations: (r) => r.navigations,
  serverRequests: (r) => r.reqlog?.total ?? null,
  storeReadRequests: (r) => r.reqlog?.reads.count ?? null,
  serverOutBytes: (r) => r.reqlog ? Object.values(r.reqlog.byRoute).reduce((a, x) => a + x.outBytes, 0) : null,
  serverInBytes: (r) => r.reqlog ? Object.values(r.reqlog.byRoute).reduce((a, x) => a + x.inBytes, 0) : null,
  cdpRequests: (r) => r.cdp?.total ?? null,
  cdpEncodedBytes: (r) => r.cdp ? Object.values(r.cdp.byRoute).reduce((a, x) => a + x.encodedBytes, 0) : null,
  characterCoreReads: (r) => r.characterCoreReads ?? null,
  peakSampledHeapUsedMiB: (r) => r.peakSampledHeapUsed ? +(r.peakSampledHeapUsed / 2 ** 20).toFixed(1) : null,
  heapUsedBeforeGcMiB: (r) => r.heapUsageBeforeGc ? +(r.heapUsageBeforeGc.usedSize / 2 ** 20).toFixed(1) : null,
  heapUsedAfterGcMiB: (r) => r.heapUsageAfterGc ? +(r.heapUsageAfterGc.usedSize / 2 ** 20).toFixed(1) : null,
  heapTotalAfterGcMiB: (r) => r.heapUsageAfterGc ? +(r.heapUsageAfterGc.totalSize / 2 ** 20).toFixed(1) : null,
  metricsJSHeapUsedMiB: (r) => r.performanceMetrics?.JSHeapUsedSize ? +(r.performanceMetrics.JSHeapUsedSize / 2 ** 20).toFixed(1) : null,
  serverRssMiB: (r) => r.serverRss?.rssMiB ?? null,
  commitWritesInWindow: (r) => r.reqlog?.commitWrites.length ?? null,
  proxyRefusals: (r) => r.proxyRefusals,
}

function summarise(records) {
  const out = {}
  for (const kind of ['cold', 'warm']) {
    const rs = records.filter(r => r.kind === kind && !r.crashed && !r.timedOut)
    const free = rs.filter(r => !r.limiterBound)
    out[kind] = { boots: rs.length, limiterBound: rs.length - free.length, metrics: {}, metricsExcludingLimiterBound: {} }
    for (const [name, f] of Object.entries(METRICS)) {
      out[kind].metrics[name] = stat(rs.map(f).filter(v => v !== null && v !== undefined))
      out[kind].metricsExcludingLimiterBound[name] = stat(free.map(f).filter(v => v !== null && v !== undefined))
    }
    // request counts and bytes by route and by key-type signature: medians over the boots
    const routes = new Set(rs.flatMap(r => Object.keys(r.reqlog?.byRoute ?? {})))
    out[kind].byRoute = Object.fromEntries([...routes].map(route => [route, {
      count: stat(rs.map(r => r.reqlog?.byRoute[route]?.count ?? 0)), outBytes: stat(rs.map(r => r.reqlog?.byRoute[route]?.outBytes ?? 0)), inBytes: stat(rs.map(r => r.reqlog?.byRoute[route]?.inBytes ?? 0)),
      cdpCount: stat(rs.map(r => r.cdp?.byRoute[route]?.count ?? 0)), cdpEncodedBytes: stat(rs.map(r => r.cdp?.byRoute[route]?.encodedBytes ?? 0)),
    }]))
    const sigs = new Set(rs.flatMap(r => Object.keys(r.reqlog?.bySignature ?? {})))
    out[kind].bySignature = Object.fromEntries([...sigs].map(s => [s, {
      requests: stat(rs.map(r => r.reqlog?.bySignature[s]?.count ?? 0)), keys: stat(rs.map(r => r.reqlog?.bySignature[s]?.keys ?? 0)), outBytes: stat(rs.map(r => r.reqlog?.bySignature[s]?.outBytes ?? 0)),
    }]))
    const types = new Set(rs.flatMap(r => Object.keys(r.reqlog?.keysByType ?? {})))
    out[kind].keysByType = Object.fromEntries([...types].map(t => [t, stat(rs.map(r => r.reqlog?.keysByType[t] ?? 0))]))
    out[kind].unattributedKeys = stat(rs.map(r => r.reqlog?.unattributedKeys ?? 0))
  }
  return out
}

function checksOf(records, run) {
  const timed = records.filter(r => !r.excluded && r.reqlog)
  const checks = {}
  // T2a: the request log and the CDP agree per /api route (static counts differ by design: the service worker answers some)
  const mismatches = []
  for (const r of timed) {
    const routes = new Set([...Object.keys(r.reqlog.byRoute), ...Object.keys(r.cdp.byRoute)].filter(x => x.startsWith('/api/')))
    for (const route of routes) {
      const a = r.reqlog.byRoute[route]?.count ?? 0
      const b = r.cdp.byRoute[route]?.count ?? 0
      if (a !== b) mismatches.push({ boot: r.kind + ' ' + r.index, route, reqlog: a, cdp: b })
    }
  }
  checks.T2a_reqlogEqualsCdpPerApiRoute = { pass: timed.length > 0 && mismatches.length === 0, bootsChecked: timed.length, mismatches: mismatches.slice(0, 20), mismatchCount: mismatches.length }
  // T2b: ready after the last read that started before it, nothing in flight at ready, last name searchable
  checks.T2b_readyAfterLastBootRead = {
    pass: timed.length > 0 && timed.every(r => r.reqlog.reads.inFlightAtReady === 0 && r.lastNameSearchable === true),
    inFlightAtReady: timed.map(r => r.reqlog.reads.inFlightAtReady), readsStartedAfterReady: timed.map(r => r.reqlog.reads.afterReady), lastNameSearchable: timed.map(r => r.lastNameSearchable),
  }
  checks.T2c_armCoreReads = { pass: timed.length > 0 && timed.every(r => r.armExpectationHolds), characterCoreReads: timed.map(r => r.characterCoreReads) }
  checks.pristineUnchanged = { pass: run.pristineUnchanged }
  checks.everyBootStartedFromPristine = { pass: records.every(r => r.hashBeforeEqualsPristine) }
  return checks
}

function fmt(s, digits = 0) { return s === null || s === undefined ? 'n/a' : `${+s.median.toFixed(digits)} (${+s.min.toFixed(digits)}-${+s.max.toFixed(digits)})` }

function tableOf(run, summary, checks) {
  const lines = [`# ${run.label} (${run.tag})`, '', `Fault: ${run.fault ?? 'none'}. Stop arm: ${run.stopArm ?? 'no'}. Slot waited ${Math.round(run.slotWaitedMs / 1000)} s.`, '', '| metric | cold median (min-max) | warm median (min-max) |', '|---|---|---|']
  for (const name of Object.keys(METRICS)) lines.push(`| ${name} | ${fmt(summary.cold.metrics[name], 1)} | ${fmt(summary.warm.metrics[name], 1)} |`)
  lines.push('', `Boots: cold ${summary.cold.boots} (limiter-bound ${summary.cold.limiterBound}), warm ${summary.warm.boots} (limiter-bound ${summary.warm.limiterBound}).`, '', '| check | pass |', '|---|---|')
  for (const [k, v] of Object.entries(checks)) lines.push(`| ${k} | ${v.pass} |`)
  return lines.join('\n') + '\n'
}
//#endregion

const arg = (k, fallback = null) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : fallback }
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv[2] === 'run') {
    const arm = arg('--arm')
    if (!arm) { console.error('usage: run --arm <tree tag> [--label <name>] [--boots 5] [--settle-ms 5000] [--boot-timeout-ms 600000]'); process.exit(2) }
    const slot = await acquireSlot('Lane-A CHORE-806 stage 2 boot runs')
    let r
    try {
      r = await runArm({ arm, label: arg('--label'), boots: Number(arg('--boots', '5')), settleMs: Number(arg('--settle-ms', '5000')), bootTimeoutMs: Number(arg('--boot-timeout-ms', '600000')), slotWaitedMs: slot.waitedMs })
    } finally {
      releaseSlot()
    }
    process.exit(r.run.error ? 1 : r.run.stopLargerSizes ? 3 : 0)
  } else if (process.argv[2] === 'arms') {
    // arms: one arm after the other; the slot is acquired once per arm, released after it, and not tried again for --pause-ms,
    // so a queued lane can take it between two arms
    const arms = (arg('--arms') ?? '').split(',').filter(Boolean)
    const pauseMs = Number(arg('--pause-ms', '90000'))
    if (arms.length === 0) { console.error('usage: arms --arms scale-on,scale-off-250 [--boots 5] [--settle-ms 5000] [--boot-timeout-ms 600000] [--pause-ms 90000]'); process.exit(2) }
    let code = 0
    for (let i = 0; i < arms.length; i++) {
      const slot = await acquireSlot('Lane-A CHORE-806 stage 2 boot runs')
      try {
        const r = await runArm({ arm: arms[i], label: arg('--label'), boots: Number(arg('--boots', '5')), settleMs: Number(arg('--settle-ms', '5000')), bootTimeoutMs: Number(arg('--boot-timeout-ms', '600000')), slotWaitedMs: slot.waitedMs })
        if (r.run.error) code = 1
        else if (r.run.stopLargerSizes && code === 0) code = 3
      } finally {
        releaseSlot()
      }
      if (i < arms.length - 1) { console.log('slot released; waiting ' + pauseMs + ' ms before the next arm'); await sleep(pauseMs) }
    }
    process.exit(code)
  } else if (process.argv[2] === 'selfcheck') {
    // selfcheck --arm <small tree tag>: one clean boot pair, then one per fault knob, under one slot hold; prints which checks failed
    const arm = arg('--arm')
    const slot = await acquireSlot('Lane-A CHORE-806 stage 2 boot runs (self-check)')
    const outcome = {}
    try {
      for (const fault of ['', 'drop-log', 'early-ready', 'arm-swap']) {
        FAULT = fault
        const r = await runArm({ arm, label: 'selfcheck-' + (fault || 'clean'), boots: 1, settleMs: 5000, bootTimeoutMs: 600000, slotWaitedMs: slot.waitedMs })
        outcome[fault || 'clean'] = Object.fromEntries(Object.entries(r.checks).map(([k, v]) => [k, v.pass]))
      }
    } finally {
      releaseSlot()
    }
    console.log('SELFCHECK ' + JSON.stringify(outcome))
    process.exit(0)
  } else {
    console.error('commands: run, arms, selfcheck')
    process.exit(2)
  }
}

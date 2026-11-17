// CHORE-806 stage 3: the save pass after one UI edit of a synthetic store2 library, through the real page on the self-hosted Node server.
//
//   node c806-savepass.mjs run --arm <tree tag, e.g. scale-on> [--label <name>] [--count 5] [--indices 0,10,20] [--quiet-ms 30000]
//   node c806-savepass.mjs arms --arms scale-on,scale-off-250 [--count 5] [--pause-ms 90000]
//   node c806-savepass.mjs selfcheck --arm <small tree tag> [--index 1]
//
// One run is one character of one arm: pristine tree restored, server restarted on the arm's fixed port, page booted to the home
// screen, then 30 s (--quiet-ms) with no save pass, then: open the character (time and reads), one UI edit (New Chat button), wait
// for the next record of the save-pass meter. Recorded per run: __risuSavePassMeter last() and units() (the switch
// risu-measure-savepass is ON), __risuCommitMeter last(), the request log of the open window and of the edit window.
// Invariants:
// - Every character gets a fresh browser profile: an untimed setup boot signs in, then the measured run boots in that profile,
//   so no earlier run's "last opened character" changes the boot or hides the home screen.
// - The tree is pristine before every run (restoreTree keeps only the login files; the commit key hash is recorded before and
//   after, and the pristine copy is hashed at the end), so an earlier run's edit never reaches a later run.
// - One arm holds the full-run slot (%TEMP%\risu-b715\fullrun-slot) from its first run to its last. `arms` releases it after each
//   arm and waits --pause-ms (default 90 s) before it tries again, so queued lanes can take it. A failure releases it too.
// - A figure from a run in which any window saw an HTTP 429 (the server's storage limiter) is labelled limiter-bound.
// - Idle passes (records that appear between ready and the quiet point) are logged apart from the edit pass; the meters are
//   reset at the quiet point, so last() and units() afterwards cover the open and the edit only.
// - Search, open, marker and edit-record times (searchPageMs, openPageMs, markerPageMs, editRecordPageMs) are page-side
//   performance.now() deltas (timeInPage in c806-page.mjs); no host polling interval is in them. The edit-record time is read
//   from the 50 ms page ticker, so it has a 50 ms resolution; it is not stamped by a MutationObserver.
// - Only PIDs this tool started are killed (server, chrome, launcher), through the c806-page and c806-server helpers.
// Fault knobs (scratch self-checks): C806_FAULT=no-edit (the edit click is skipped, so no pass record can come),
// wrong-char (the attribution looks at another character's units).
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { C806_ROOT, REPO_ROOT, commitKeyHash, dirsOf, prepareDist, restoreTree, scratchPath, serverRss, startServer, listenable, pickFreePort } from './c806-server.mjs'
import { attach, closeChrome, fillPasswordPrompt, launchChrome, readReqlog, sleep, findByNameTimed, openLibrary, timeInPage, clickByTextExpression, libraryRows, snapshotOf } from './c806-page.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SLOT = path.join(os.tmpdir(), 'risu-b715', 'fullrun-slot')
const SLOT_OWNER_TEXT = 'Lane-A CHORE-806 stage 3 save-pass runs'
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
      await sleep(5000)
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
function readyObserverInPage() {
  const state = { readyAt: null, readyKind: null, promptAt: null }
  window.__c806Boot = state
  const stamp = () => performance.timeOrigin + performance.now()
  const check = () => {
    if (state.promptAt === null && document.querySelector('#alert-input')) state.promptAt = stamp()
    if (state.readyAt === null) {
      if (document.querySelector('[data-part=home-landing]')) { state.readyAt = stamp(); state.readyKind = 'home' }
      else if (document.querySelector('[data-part=chat-messages]')) { state.readyAt = stamp(); state.readyKind = 'chat' }
    }
  }
  new MutationObserver(check).observe(document, { childList: true, subtree: true })
}

/** Census keys of every character: chaId -> [{ key, type }], plus the arm's archive flag. */
function loadCensus(censusFile) {
  const census = JSON.parse(fs.readFileSync(censusFile, 'utf8')).census
  const typeMap = new Map()
  const rowsByChaId = new Map()
  for (const row of census.characters.rows) {
    rowsByChaId.set(row.chaId, row.keys)
    for (const k of row.keys) typeMap.set(k.key, k.type)
  }
  return { typeMap, rowsByChaId, archive: census.configArchiveCharacters }
}

function typeOfKey(key, typeMap) {
  const known = typeMap.get(key)
  if (known) return known
  if (key === 'store2-commit' || key === 'store2-fence' || key === 'store2-sweep') return key
  const m = /^store2\/g-[^-]+-([a-z])/.exec(key)
  if (m) return m[1] === 'm' ? 'manifest' : m[1] === 's' ? 'shard' : 'unit-untyped'
  return 'other'
}

/** openLibrary, tried again when the Character button's click did not open the library; the last page snapshot is kept in the error. */
async function openLibraryRetry(c) {
  let lastError = null
  for (let attempt = 0; attempt < 4; attempt++) {
    try { await openLibrary(c); return attempt } catch (e) { lastError = e; await sleep(2000) }
  }
  const snap = await snapshotOf(c).catch(() => null)
  throw new Error('the library did not open: ' + String(lastError?.message).slice(0, 120) + ' ' + JSON.stringify(snap).slice(0, 500))
}

async function waitPortFree(port, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await listenable(port)) return true
    await sleep(200)
  }
  return false
}

/** Request counts and bytes of the log lines between t0 and t1, by route and by key type. */
function windowOf(lines, t0, t1, typeMap) {
  const out = { requests: 0, limited429: 0, inBytes: 0, outBytes: 0, reads: 0, readBytes: 0, readKeysByType: {}, readBytesByType: {}, writes: 0, writeInBytes: 0, writeKeys: [], commitPosts: [], firstReadT0: null, lastReadT1: null }
  const readKeys = new Set()
  for (const l of lines) {
    if (l.t0 < t0 || l.t0 > t1) continue
    if (!l.route.startsWith('/api/')) continue
    out.requests++
    out.inBytes += l.inBytes
    out.outBytes += l.outBytes
    if (l.limited) out.limited429++
    if (l.method === 'GET' && l.route === '/api/read') {
      out.reads++
      out.readBytes += l.outBytes
      out.firstReadT0 = out.firstReadT0 === null ? l.t0 : Math.min(out.firstReadT0, l.t0)
      out.lastReadT1 = out.lastReadT1 === null ? l.t1 : Math.max(out.lastReadT1, l.t1)
      if (Array.isArray(l.keys)) for (const k of l.keys) {
        readKeys.add(k)
        const t = typeOfKey(k, typeMap)
        out.readKeysByType[t] = (out.readKeysByType[t] ?? 0) + 1
        out.readBytesByType[t] = (out.readBytesByType[t] ?? 0) + Math.round(l.outBytes / Math.max(1, l.keyCount))
      }
    } else if (l.method === 'POST') {
      out.writes++
      out.writeInBytes += l.inBytes
      if (Array.isArray(l.keys)) for (const k of l.keys) if (k !== 'store2-commit') out.writeKeys.push(k)
      if (l.classes['store2-commit']) out.commitPosts.push({ t0: l.t0, t1: l.t1, ifMatch: l.ifMatch, status: l.status })
    }
  }
  out.distinctReadKeys = readKeys.size
  out.readKeySet = readKeys
  return out
}
//#endregion

//#region one run
const METER_COUNTS = `({ p: globalThis.__risuSavePassMeter?.all().length ?? -1, u: globalThis.__risuSavePassMeter?.units().length ?? -1, m: globalThis.__risuCommitMeter?.all().length ?? -1 })`

/** Boots to the home screen on the arm's server, answering the sign-in prompt whenever it shows. Resolves { readyMs, readyAtEpoch }. */
async function bootToReady(ctx, timeoutMs) {
  const { c, state, server, cur } = ctx
  state.navigations = 0
  cur.crashed = false
  const tNav = Date.now()
  await c.send('Page.navigate', { url: server.baseUrl + '/' })
  let lastAnswer = 0
  let prompts = 0
  while (Date.now() - tNav < timeoutMs) {
    if (cur.crashed) throw new Error('renderer crashed during the boot')
    let st = null
    try { st = await guarded(c.ev('({ b: window.__c806Boot ?? null, prompt: !!document.querySelector("#alert-input") })'), 15000, 'ready poll') } catch { st = null }
    if (st && st.b && st.b.readyAt !== null) return { readyMs: Math.round(st.b.readyAt - tNav), readyAtEpoch: st.b.readyAt, readyKind: st.b.readyKind, prompts, navigations: state.navigations, tNav }
    if (st && st.prompt && Date.now() - lastAnswer > 3000) {
      prompts++
      lastAnswer = Date.now()
      try { await guarded(fillPasswordPrompt(c), 15000, 'sign-in prompt') } catch {}
    }
    await sleep(300)
  }
  throw new Error('no ready within ' + timeoutMs + ' ms')
}

/** Waits until the meters showed no new record for quietMs. Resolves { quiet, waitedMs }. */
async function waitQuiet(ctx, quietMs, maxMs) {
  const t0 = Date.now()
  let last = null
  let lastChange = Date.now()
  while (Date.now() - t0 < maxMs) {
    let sig = null
    try { sig = JSON.stringify(await guarded(ctx.c.ev(METER_COUNTS), 20000, 'quiet poll')) } catch {}
    if (sig !== last) { last = sig; lastChange = Date.now() }
    if (Date.now() - lastChange >= quietMs) return { quiet: true, waitedMs: Date.now() - t0 }
    await sleep(1000)
  }
  return { quiet: false, waitedMs: Date.now() - t0 }
}

/**
 * A written unit's key is new (the key changes with the bytes), so the census keys cannot name it. Its identity can: a chat unit's
 * identity is `chat:<entity id>:<chat id>:...`, and the library gives the chat ids of the opened character. The entity id of the
 * edited character is the one on a chat unit whose chat id belongs to that library character; every unit with that entity id
 * (character core, its chats) counts as the edited character's. Shards, the manifest and any other entity count as outside.
 */
const summariseUnits = (units, libraryChatIds, namingUnits = []) => {
  const byType = {}
  const byKind = {}
  let bytes = 0
  let entity = null
  const entities = new Set()
  // the pass that the open itself writes also rewrites the library chats, so its identities name the entity too
  for (const u of namingUnits) {
    const m = /^chat:([^:]+):([^:]+):/.exec(u.identity)
    if (m && libraryChatIds.has(m[2])) entity = m[1]
  }
  for (const u of units) {
    const m = /^chat:([^:]+):([^:]+):/.exec(u.identity)
    if (m) {
      entities.add(m[1])
      if (libraryChatIds.has(m[2])) entity = m[1]
    }
    const c = /^char:([^:]+):/.exec(u.identity)
    if (c) entities.add(c[1])
  }
  let inCharacter = 0
  for (const u of units) {
    byType[u.type] = (byType[u.type] ?? 0) + 1
    byKind[u.identity.split(':')[0]] = (byKind[u.identity.split(':')[0]] ?? 0) + 1
    bytes += u.bytes
    // identities that carry the entity id: char:<e>:..., chat:<e>:..., al:char:<e>, il:char:<e>
    if (entity !== null && u.identity.split(':').includes(entity)) inCharacter++
  }
  return { count: units.length, bytes, byType, byKind, entity, entitiesInPass: entities.size, inCharacter, outsideCharacter: units.length - inCharacter }
}

async function parkAndStop(ctx, rec) {
  const { c, d } = ctx
  if (!ctx.cur.crashed) {
    try { await guarded(c.send('Page.navigate', { url: 'about:blank' }), 20000, 'park page'); await sleep(1500) } catch (e) { rec.parkError = String(e.message) }
  }
  if (ctx.server) { await ctx.server.stop(); ctx.server = null }
  rec.commitHashAfter = commitKeyHash(d.save)
  rec.commitHashChanged = rec.commitHashAfter !== rec.commitHashBefore
}

/** Starts the arm's server on its fixed port after a restore of the pristine tree. */
async function freshServer(ctx, rec) {
  rec.restore = restoreTree(ctx.tag, ctx.treeDir)
  rec.commitHashBefore = commitKeyHash(ctx.d.save)
  rec.hashBeforeEqualsPristine = rec.commitHashBefore === ctx.pristineHash
  let server = null
  for (let attempt = 0; server === null; attempt++) {
    if (!(await waitPortFree(ctx.port))) { if (attempt >= 20) throw new Error('the port did not free: ' + ctx.port); continue }
    try { server = await startServer({ tag: ctx.tag, port: ctx.port }) } catch (e) {
      if (attempt >= 20) throw e
      rec.serverStartRetries = (rec.serverStartRetries ?? 0) + 1
      await sleep(3000)
    }
  }
  ctx.server = server
  rec.serverPid = server.pid
}

/** One run: the setup boot (the sign-in of a fresh profile; nothing measured) when index is null, else character `index`. */
async function runOnce(ctx, index) {
  const { c, d, p, lib, census } = ctx
  const rec = { index, setup: index === null, startedAt: new Date().toISOString() }
  await freshServer(ctx, rec)
  const refusalsFile = path.join(ctx.chromeDir, 'proxy-refusals.jsonl')
  const refusalsBefore = fs.existsSync(refusalsFile) ? fs.readFileSync(refusalsFile, 'utf8').split('\n').filter(Boolean).length : 0
  try {
    const boot = await bootToReady(ctx, ctx.bootTimeoutMs)
    rec.boot = { readyMs: boot.readyMs, readyKind: boot.readyKind, prompts: boot.prompts, navigations: boot.navigations }
    if (index === null) {
      await sleep(3000)
      return rec
    }
    const ch = lib.buildCharacter(p, index)
    rec.name = ch.name
    rec.chaId = ch.chaId
    const row = census.rowsByChaId.get(ch.chaId)
    if (!row) throw new Error('the census has no row for ' + ch.chaId)
    // the wrong-char knob attributes the pass to the neighbouring character's chats
    const attributionChat = FAULT === 'wrong-char' ? lib.buildCharacter(p, (index + 1) % p.characters) : ch
    const libraryChatIds = new Set(attributionChat.chats.map(chat => chat.id))
    rec.censusLeafCount = new Set(row.filter(k => k.type !== 'shard').map(k => k.key)).size
    // idle: wait until no pass record came for quietMs; the boot's own first pass lands in this wait and is logged apart.
    // The save-pass meter global exists only once the first pass has run (its module loads with the save loop), so it is checked after the wait.
    const readyPageMs = boot.readyAtEpoch - (await c.ev('performance.timeOrigin'))
    const quiet = await waitQuiet(ctx, ctx.quietMs, ctx.quietMaxMs)
    rec.quiet = quiet
    const meterType = await c.ev(`({ savePass: typeof globalThis.__risuSavePassMeter, commit: typeof globalThis.__risuCommitMeter, switchOn: localStorage.getItem('risu-measure-savepass') })`)
    rec.meters = meterType
    if (meterType.savePass !== 'object' || meterType.commit !== 'object' || meterType.switchOn !== 'on') throw new Error('the meters are not installed or the switch is off: ' + JSON.stringify(meterType))
    const idle = await c.ev(`({ passes: __risuSavePassMeter.all().map(r => ({ kind: r.kind, ms: r.ms, seq: r.seq, at: r.at, characters: r.characters, modules: r.modules })), units: __risuSavePassMeter.units().map(u => ({ kind: u.kind, seq: u.seq, count: u.units.length, bytes: u.units.reduce((a, x) => a + x.bytes, 0) })), commits: __risuCommitMeter.all() })`)
    rec.idle = { readyPageMs: Math.round(readyPageMs), passes: idle.passes, units: idle.units, commits: idle.commits }
    await c.ev('(() => { __risuSavePassMeter.reset(); __risuCommitMeter.reset() })()')
    if (!quiet.quiet) throw new Error('no quiet point within ' + ctx.quietMaxMs + ' ms')
    ctx.lastQuietAt = Date.now()

    // open the character
    const lines0 = readReqlog(d.reqlog).length
    const tOpenStart = Date.now()
    await openLibraryRetry(c)
    // The search, the open and the marker are timed in the page (timeInPage, performance.now() deltas), so the *PageMs figures carry
    // no host polling interval and no CDP round trip; the earlier searchMs, openMs and markerMs were host-polled upper bounds.
    const search = await findByNameTimed(c, ch.name)
    if (!search.found) throw new Error('the character name is not searchable: ' + ch.name + ' ' + JSON.stringify({ rows: (await libraryRows(c)).slice(0, 8) }))
    // the first message of the shown chat names the character's content; any message of the character counts
    const markers = ch.chats.flatMap(chat => chat.message.map(m => String(m.data).slice(0, 24)))
    const opened = await timeInPage(c, {
      actionExpr: clickByTextExpression('[data-part=character-name-row]', ch.name),
      conditions: [
        { name: 'chat', expr: `!!document.querySelector('[data-part=chat-messages]')` },
        { name: 'marker', expr: `(() => { const t = document.body.innerText; return ${JSON.stringify(markers)}.some(m => t.includes(m)) })()`, withinMs: 20000 },
      ],
      timeoutMs: 140000,
    })
    if (!opened.acted) throw new Error('no library row for ' + ch.name)
    if (opened.hits.chat === null) throw new Error('the chat did not show for ' + ch.name + ' (timed out ' + opened.timedOut + ')')
    const markerShown = opened.hits.marker !== null
    await sleep(3000)
    const openLines = readReqlog(d.reqlog).slice(lines0)
    const ow = windowOf(openLines, tOpenStart, Date.now(), census.typeMap)
    const leafKeys = new Set(row.filter(k => k.type !== 'shard').map(k => k.key))
    const readUnitKeys = [...ow.readKeySet].filter(k => k.startsWith('store2/'))
    delete ow.readKeySet
    rec.open = {
      searchPageMs: search.searchPageMs, searchRowAlreadyShown: search.alreadyShown, openPageMs: opened.hits.chat, markerShown, markerPageMs: opened.hits.marker, window: ow,
      readUnitKeyCount: readUnitKeys.length, readInsideLeaves: readUnitKeys.filter(k => leafKeys.has(k)).length, readOutsideLeaves: readUnitKeys.filter(k => !leafKeys.has(k)).length,
      leavesNotRead: [...leafKeys].filter(k => !readUnitKeys.includes(k)).length,
    }
    const afterOpen = await c.ev(METER_COUNTS)
    rec.open.passesDuringOpen = afterOpen

    // one UI edit: the New Chat button of the open character; then the next record of the save-pass meter
    const n0 = afterOpen
    const lines1 = readReqlog(d.reqlog).length
    const tEdit = Date.now()
    // the click and the wait for the next unit record run in one page-side promise: recordSeenPageMs is a performance.now() delta
    const edited = await timeInPage(c, {
      actionExpr: FAULT === 'no-edit' ? 'true' : clickByTextExpression('button', 'New Chat'),
      conditions: [{ name: 'record', expr: `(globalThis.__risuSavePassMeter?.units().length ?? -1) > ${n0.u}` }],
      timeoutMs: ctx.editTimeoutMs,
    })
    if (!edited.acted) throw new Error('no New Chat button after opening ' + ch.name)
    const recordSeen = edited.hits.record !== null
    await sleep(2500)
    const meter = await c.ev(`({
      last: __risuSavePassMeter.last(),
      passesAfter: __risuSavePassMeter.all(),
      units: __risuSavePassMeter.units(),
      commitLast: __risuCommitMeter.last(),
      commitAll: __risuCommitMeter.all(),
      counts: ${METER_COUNTS},
    })`)
    const editLines = readReqlog(d.reqlog).slice(lines1)
    const ew = windowOf(editLines, tEdit, Date.now(), census.typeMap)
    delete ew.readKeySet
    rec.edit = { clicked: FAULT !== 'no-edit', recordSeen, recordSeenPageMs: edited.hits.record, window: ew }
    // the edit pass is the first unit record of kind edit; any other record is logged as an extra pass
    // opening a character writes its own pass (recorded before the edit), so only the records after the edit click count
    const unitsAll = meter.units.slice(n0.u)
    rec.open.passUnitRecords = meter.units.slice(0, n0.u).map(u => ({ kind: u.kind, seq: u.seq, count: u.units.length, bytes: u.units.reduce((a, x) => a + x.bytes, 0), identities: u.units.map(x => x.identity) }))
    const editUnitRec = unitsAll.find(u => u.kind === 'edit') ?? unitsAll[0] ?? null
    rec.edit.extraUnitRecords = unitsAll.filter(u => u !== editUnitRec).map(u => ({ kind: u.kind, seq: u.seq, count: u.units.length }))
    rec.edit.passRecordCount = meter.passesAfter.length - n0.p
    rec.edit.unitRecordCount = unitsAll.length
    rec.edit.last = meter.last
    rec.edit.passRecord = editUnitRec && editUnitRec.seq !== undefined ? (meter.passesAfter.find(r => r.seq === editUnitRec.seq) ?? null) : null
    rec.edit.unitRecord = editUnitRec === null ? null : { kind: editUnitRec.kind, seq: editUnitRec.seq, acknowledgeMs: editUnitRec.acknowledgeMs, commitBuildMs: editUnitRec.commitBuildMs, builds: editUnitRec.builds, unitCounts: editUnitRec.unitCounts, units: editUnitRec.units }
    rec.edit.unitSummary = editUnitRec === null ? null : summariseUnits(editUnitRec.units, libraryChatIds, [...meter.units.slice(0, n0.u).flatMap(u => u.units), ...editUnitRec.units])
    rec.edit.commitMeterLast = meter.commitLast
    rec.edit.commitMeterRecords = meter.commitAll.length
    // the commit meter counts the units and the manifest it handed to the backend; the request log shows the keys that were written
    const writtenStore2 = new Set(ew.writeKeys.filter(k => k.startsWith('store2/')))
    rec.edit.reqlogWrittenStore2Keys = writtenStore2.size
    rec.edit.commitUnitsEqualReqlogKeys = meter.commitLast !== null && meter.commitLast.units === writtenStore2.size
    rec.edit.commitPosts = ew.commitPosts
    rec.edit.editToCommitPostMs = ew.commitPosts.length > 0 ? Math.round(ew.commitPosts[ew.commitPosts.length - 1].t1 - tEdit) : null
    try { rec.serverRss = serverRss(ctx.server.pid) } catch (e) { rec.serverRssError = String(e.message) }
    return rec
  } catch (e) {
    rec.error = String(e.message).slice(0, 600)
    return rec
  } finally {
    rec.proxyRefusals = (fs.existsSync(refusalsFile) ? fs.readFileSync(refusalsFile, 'utf8').split('\n').filter(Boolean).length : 0) - refusalsBefore
    rec.crashed = ctx.cur.crashed
    await parkAndStop(ctx, rec)
    const keep = path.join(ctx.runDir, `reqlog-${index === null ? 'setup-' + ctx.currentIndex : 'k' + index}.jsonl`)
    if (fs.existsSync(ctx.d.reqlog)) fs.copyFileSync(ctx.d.reqlog, keep)
    const lim = readReqlog(keep).filter(l => l.limited).length
    rec.limited429Total = lim
    rec.limiterBound = lim > 0
  }
}
//#endregion

//#region arm
// The library search shows at most 19 matching rows and matches substrings, so "Synthetic 5" never shows its own row among 100+
// hits. A three-digit index (100-999) has a name no other character's name contains, so a library of more than 200 characters
// is sampled from index 100 up.
const spread = (n, count) => {
  const lo = n > 200 ? 100 : 0
  const span = n - lo
  if (count >= span) return Array.from({ length: span }, (_, i) => lo + i)
  const out = []
  for (let i = 0; i < count; i++) out.push(lo + Math.floor(i * (span - 1) / (count - 1 || 1)))
  return [...new Set(out)]
}

async function runArm({ arm, label, indices, count, quietMs, slotWaitedMs }) {
  const tag = 's3-' + arm + '-' + Date.now()
  const treeDir = scratchPath(C806_ROOT, 'data', arm, 'pristine')
  const treeJson = JSON.parse(fs.readFileSync(path.join(C806_ROOT, 'runs', 'stage1', arm, 'tree.json'), 'utf8'))
  const censusFile = path.join(C806_ROOT, 'runs', 'stage1', arm + '-census', 'census.json')
  const dist = scratchPath(C806_ROOT, 'build', 'dist')
  const runDir = scratchPath(C806_ROOT, 'runs', 'stage3', tag)
  fs.mkdirSync(runDir, { recursive: true })
  const lib = await import(pathToFileURL(path.join(REPO_ROOT, 'Agents', 'Tools', 'save-gen', 'c806-library.mjs')).href)
  const p = lib.normalizeParams(treeJson.params)
  const chosen = indices ?? spread(p.characters, count)
  const census = loadCensus(censusFile)
  const pristineHash = commitKeyHash(treeDir)
  const switches = { 'risu-measure-savepass': 'on', 'risu-measure-import': 'off' }
  const run = {
    tag, arm, label: label ?? arm, startedAt: new Date().toISOString(), slotWaitedMs, params: treeJson.params, counts: treeJson.counts, fault: FAULT || null,
    indices: chosen, archiveCharacters: census.archive, quietMs,
    provenance: {
      head: gitText('rev-parse', 'HEAD'), statusToolsAndSrc: gitText('status', '--short', '--', 'Agents/Tools', 'src').split('\n').filter(Boolean),
      toolSha256: Object.fromEntries(['c806-savepass.mjs', 'c806-page.mjs', 'c806-server.mjs', 'c806-reqlog.cjs'].map(f => [f, sha256File(path.join(HERE, f))])),
      distIndexSha256: prepareDist(tag, dist), pristineTree: treeDir, pristineCommitKeyHash: pristineHash, pristineFiles: treeJson.tree.files,
      cpu: os.cpus()[0].model + ' x' + os.cpus().length, ramGiB: +(os.totalmem() / 2 ** 30).toFixed(1), node: process.version, platform: os.platform() + ' ' + os.release(),
      meterSwitches: switches,
      proxyHop: 'every page request goes through the launcher loopback proxy (a Node hop); wall times include it',
      hardwareCaveat: 'best-case desktop hardware (i9 class); diagnostic numbers, not thresholds, nothing about phones or a Pi',
      meterOverhead: 'risu-measure-savepass is ON: the pass is slower than a build without timers by the meter overhead',
    },
  }
  const d = dirsOf(tag)
  const ctx = { tag, d, treeDir, census, lib, p, quietMs, quietMaxMs: Math.max(300000, quietMs * 4), editTimeoutMs: 120000, bootTimeoutMs: 600000, runDir, pristineHash, cur: { crashed: false }, server: null, c: null, state: null }
  let h = null
  const records = []
  run.closed = []
  run.browsers = []
  const cleanup = async () => {
    if (ctx.server) { try { await ctx.server.stop() } catch {} ctx.server = null }
    if (h) { run.closed.push(await closeChrome(h)); h = null }
  }
  const onSignal = () => { cleanup().finally(() => { releaseSlot(); process.exit(130) }) }
  process.on('SIGINT', onSignal)
  process.on('SIGTERM', onSignal)
  try {
    restoreTree(tag, treeDir)
    const first = await startServer({ tag, port: await pickFreePort(6860 + Math.floor(Math.random() * 30)) })
    ctx.port = first.port
    await first.stop()
    for (const index of chosen) {
      // A fresh browser profile per character: the page reopens the last character of its own profile, which would add that
      // character's reads to the next boot and leave no home screen to open a character from. The setup boot (the sign-in of
      // the fresh profile) is untimed and measures nothing.
      ctx.currentIndex = index
      ctx.chromeDir = scratchPath(runDir, 'chrome-' + index)
      h = await launchChrome({ runDir: ctx.chromeDir, profileName: tag + '-k' + index })
      const { c, state } = await attach(h, { switches })
      ctx.c = c
      ctx.state = state
      await c.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${readyObserverInPage.toString()})()` })
      c.on((m) => { if (m.method === 'Inspector.targetCrashed') ctx.cur.crashed = true })
      run.chromeVersion = (await c.send('Browser.getVersion')).product
      run.browsers.push({ index, chrome: h.chrome, launcher: h.launcher, cdpPort: h.cdpPort, serverPort: ctx.port })
      let stop = null
      for (const step of [null, index]) {
        const rec = await runOnce(ctx, step)
        records.push(rec)
        console.log(JSON.stringify({ index, step: step === null ? 'setup' : 'measured', name: rec.name, readyMs: rec.boot?.readyMs, openPageMs: rec.open?.openPageMs, recordSeen: rec.edit?.recordSeen, units: rec.edit?.unitSummary?.count, limiterBound: rec.limiterBound, error: rec.error }))
        fs.writeFileSync(path.join(runDir, 'runs.json'), JSON.stringify(records, null, 2))
        if (rec.crashed || (rec.error && /renderer crashed|no ready within/.test(rec.error))) { stop = (rec.crashed ? 'renderer crash' : rec.error) + ' at character ' + index; break }
        if (rec.error) break
      }
      run.closed.push(await closeChrome(h))
      h = null
      if (stop !== null) { run.stopArm = stop; break }
    }
  } catch (e) {
    run.error = String(e.stack ?? e).slice(0, 2000)
  } finally {
    await cleanup()
    run.pristineCommitKeyHashAtEnd = commitKeyHash(treeDir)
    run.pristineUnchanged = run.pristineCommitKeyHashAtEnd === pristineHash
    run.finishedAt = new Date().toISOString()
    fs.writeFileSync(path.join(runDir, 'run.json'), JSON.stringify(run, null, 2))
    fs.writeFileSync(path.join(runDir, 'runs.json'), JSON.stringify(records, null, 2))
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
  const measured = records.filter(r => !r.setup)
  const summary = summarise(measured)
  const checks = checksOf(records, run)
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify(summary, null, 2))
  fs.writeFileSync(path.join(runDir, 'checks.json'), JSON.stringify(checks, null, 2))
  fs.writeFileSync(path.join(runDir, 'information.json'), JSON.stringify(informationOf(records), null, 2))
  fs.writeFileSync(path.join(runDir, 'table.md'), tableOf(run, measured, summary, checks))
  console.log(tableOf(run, measured, summary, checks))
  console.log('run folder ' + runDir)
  return { runDir, run, summary, checks }
}
//#endregion

//#region summary and checks
const METRICS = {
  bootReadyMs: (r) => r.boot?.readyMs ?? null,
  idlePassRecords: (r) => r.idle ? r.idle.passes.length : null,
  idleUnitRecords: (r) => r.idle ? r.idle.units.length : null,
  searchPageMs: (r) => r.open?.searchPageMs ?? null,
  openPageMs: (r) => r.open?.openPageMs ?? null,
  markerPageMs: (r) => r.open?.markerPageMs ?? null,
  openReads: (r) => r.open?.window.reads ?? null,
  openReadBytes: (r) => r.open?.window.readBytes ?? null,
  openReadUnitKeys: (r) => r.open?.readUnitKeyCount ?? null,
  openCensusLeaves: (r) => r.censusLeafCount ?? null,
  passMs: (r) => r.edit?.passRecord?.ms ?? null,
  passCharactersEncoded: (r) => r.edit?.passRecord?.characters ?? null,
  passModulesEncoded: (r) => r.edit?.passRecord ? (r.edit.passRecord.modules ? 1 : 0) : null,
  passSyncMs: (r) => r.edit?.passRecord?.split?.syncMs ?? null,
  passPuts: (r) => r.edit?.passRecord?.split?.puts ?? null,
  passUnitEncodeMs: (r) => r.edit?.passRecord?.split?.unitEncodeMs ?? null,
  passUnitDigestMs: (r) => r.edit?.passRecord?.split?.unitDigestMs ?? null,
  acknowledgeMs: (r) => r.edit?.unitRecord?.acknowledgeMs ?? null,
  commitBuildMs: (r) => r.edit?.unitRecord?.commitBuildMs ?? null,
  unitsWritten: (r) => r.edit?.unitSummary?.count ?? null,
  unitBytesWritten: (r) => r.edit?.unitSummary?.bytes ?? null,
  unitsInEditedCharacter: (r) => r.edit?.unitSummary?.inCharacter ?? null,
  unitsOutsideEditedCharacter: (r) => r.edit?.unitSummary?.outsideCharacter ?? null,
  commitMeterMs: (r) => r.edit?.commitMeterLast?.ms ?? null,
  commitMeterUnits: (r) => r.edit?.commitMeterLast?.units ?? null,
  commitMeterTotalBytes: (r) => r.edit?.commitMeterLast?.totalBytes ?? null,
  editRecordPageMs: (r) => r.edit?.recordSeenPageMs ?? null,
  editToCommitPostMs: (r) => r.edit?.editToCommitPostMs ?? null,
  editWriteRequests: (r) => r.edit?.window.writes ?? null,
  editWriteInBytes: (r) => r.edit?.window.writeInBytes ?? null,
  serverRssMiB: (r) => r.serverRss?.rssMiB ?? null,
}

function summarise(runs) {
  const out = { runs: runs.length, limiterBoundRuns: runs.filter(r => r.limiterBound).length, metrics: {}, metricsExcludingLimiterBound: {}, unitsByType: {} }
  const free = runs.filter(r => !r.limiterBound)
  for (const [name, f] of Object.entries(METRICS)) {
    out.metrics[name] = stat(runs.map(f).filter(v => v !== null && v !== undefined))
    out.metricsExcludingLimiterBound[name] = stat(free.map(f).filter(v => v !== null && v !== undefined))
  }
  const types = new Set(runs.flatMap(r => Object.keys(r.edit?.unitSummary?.byType ?? {})))
  out.unitsByType = Object.fromEntries([...types].map(t => [t, stat(runs.map(r => r.edit?.unitSummary?.byType[t] ?? 0))]))
  const readTypes = new Set(runs.flatMap(r => Object.keys(r.open?.window.readKeysByType ?? {})))
  out.openReadKeysByType = Object.fromEntries([...readTypes].map(t => [t, stat(runs.map(r => r.open?.window.readKeysByType[t] ?? 0))]))
  return out
}

function checksOf(records, run) {
  const measured = records.filter(r => !r.setup)
  const checks = {}
  // T3a: every run saw an edit record that names the edited character, and the commit meter's unit count equals the keys the request log shows written
  checks.T3a_passNamesEditedCharacter = {
    pass: measured.length > 0 && measured.every(r => !r.error && r.edit?.recordSeen === true && (r.edit.unitSummary?.inCharacter ?? 0) > 0),
    perRun: measured.map(r => ({ index: r.index, recordSeen: r.edit?.recordSeen ?? null, inCharacter: r.edit?.unitSummary?.inCharacter ?? null, outside: r.edit?.unitSummary?.outsideCharacter ?? null, error: r.error ?? null })),
  }
  checks.T3a_commitUnitsEqualReqlogWrites = { pass: measured.length > 0 && measured.every(r => r.edit?.commitUnitsEqualReqlogKeys === true), perRun: measured.map(r => ({ index: r.index, commitUnits: r.edit?.commitMeterLast?.units ?? null, reqlogKeys: r.edit?.reqlogWrittenStore2Keys ?? null })) }
  checks.pristineUnchanged = { pass: run.pristineUnchanged }
  checks.everyRunStartedFromPristine = { pass: records.every(r => r.hashBeforeEqualsPristine) }
  return checks
}

/** Figures that no check asserts: the keys the open read against the character's census leaves (information.json, not the pass list). */
function informationOf(records) {
  return {
    openReadsVersusCensusLeaves: records.filter(r => !r.setup).map(r => ({ index: r.index, readUnitKeys: r.open?.readUnitKeyCount ?? null, insideLeaves: r.open?.readInsideLeaves ?? null, outsideLeaves: r.open?.readOutsideLeaves ?? null, leavesNotRead: r.open?.leavesNotRead ?? null, censusLeaves: r.censusLeafCount ?? null })),
  }
}

function fmt(s, digits = 0) { return s === null || s === undefined ? 'n/a' : `${+s.median.toFixed(digits)} (${+s.min.toFixed(digits)}-${+s.max.toFixed(digits)})` }

function tableOf(run, measured, summary, checks) {
  const lines = [`# ${run.label} (${run.tag})`, '', `Fault: ${run.fault ?? 'none'}. Stop arm: ${run.stopArm ?? 'no'}. Slot waited ${Math.round(run.slotWaitedMs / 1000)} s. Characters: ${run.indices.join(', ')}. Archive: ${run.archiveCharacters}.`, '', '| metric | median (min-max) all runs | median (min-max) without limiter-bound |', '|---|---|---|']
  for (const name of Object.keys(METRICS)) lines.push(`| ${name} | ${fmt(summary.metrics[name], 1)} | ${fmt(summary.metricsExcludingLimiterBound[name], 1)} |`)
  lines.push('', `Runs ${summary.runs}, limiter-bound ${summary.limiterBoundRuns}.`, '', '| check | pass |', '|---|---|')
  for (const [k, v] of Object.entries(checks)) lines.push(`| ${k} | ${v.pass} |`)
  return lines.join('\n') + '\n'
}
//#endregion

const arg = (k, fallback = null) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : fallback }
const indicesArg = () => arg('--indices') ? arg('--indices').split(',').map(Number) : null
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const cmd = process.argv[2]
  if (cmd === 'run') {
    const arm = arg('--arm')
    if (!arm) { console.error('usage: run --arm <tree tag> [--label <name>] [--count 5] [--indices 0,10] [--quiet-ms 30000]'); process.exit(2) }
    const slot = await acquireSlot(SLOT_OWNER_TEXT)
    let r
    try {
      r = await runArm({ arm, label: arg('--label'), indices: indicesArg(), count: Number(arg('--count', '5')), quietMs: Number(arg('--quiet-ms', '30000')), slotWaitedMs: slot.waitedMs })
    } finally {
      releaseSlot()
    }
    process.exit(r.run.error ? 1 : r.run.stopArm ? 3 : 0)
  } else if (cmd === 'arms') {
    // arms: one arm after the other; the slot is acquired once per arm, released after it, and not tried again for --pause-ms
    const arms = (arg('--arms') ?? '').split(',').filter(Boolean)
    const pauseMs = Number(arg('--pause-ms', '90000'))
    if (arms.length === 0) { console.error('usage: arms --arms scale-on,scale-off-250 [--count 5] [--pause-ms 90000]'); process.exit(2) }
    let code = 0
    for (let i = 0; i < arms.length; i++) {
      const slot = await acquireSlot(SLOT_OWNER_TEXT)
      try {
        const r = await runArm({ arm: arms[i], label: arg('--label'), indices: indicesArg(), count: Number(arg('--count', '5')), quietMs: Number(arg('--quiet-ms', '30000')), slotWaitedMs: slot.waitedMs })
        if (r.run.error) code = 1
      } finally {
        releaseSlot()
      }
      if (i < arms.length - 1) { console.log('slot released; waiting ' + pauseMs + ' ms before the next arm'); await sleep(pauseMs) }
    }
    process.exit(code)
  } else if (cmd === 'selfcheck') {
    // selfcheck --arm <small tree tag> [--index 1]: one clean run, then one per fault knob, one slot hold; prints which checks failed
    const arm = arg('--arm')
    const index = Number(arg('--index', '1'))
    const slot = await acquireSlot(SLOT_OWNER_TEXT + ' (self-check)')
    const outcome = {}
    try {
      for (const fault of ['', 'no-edit', 'wrong-char']) {
        FAULT = fault
        const r = await runArm({ arm, label: 'selfcheck-' + (fault || 'clean'), indices: [index], count: 1, quietMs: 10000, slotWaitedMs: slot.waitedMs })
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

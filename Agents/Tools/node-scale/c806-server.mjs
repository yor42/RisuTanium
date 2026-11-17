// CHORE-806: starts the repository's own self-hosted Node server (server/node/server.cjs) on a scratch folder, for measurement runs.
//
//   node c806-server.mjs start   --tag <t> --dist <measurement dist> [--tree <pristine tree>] [--port <n>]   (foreground; Ctrl+C or stop ends it)
//   node c806-server.mjs stop    --tag <t>                                                                  (kills the recorded PID after an identity check)
//   node c806-server.mjs restore --tag <t> --tree <pristine tree>                                           (server must be stopped)
//   node c806-server.mjs selftest-identity                                                                  (T1d: a dummy listener must be refused)
//
// Layout under C806_ROOT (default <os temp>/risu-b715/b61/c806): data/<tag>/srv/{save,dist}, requests.jsonl, server.log, pids.json.
// Invariants:
// - The server runs with a scratch cwd, so `save/` and `dist/` are the scratch copies. No ssl folder exists there: plain HTTP.
// - It binds 127.0.0.1 on a free port of 6800-6899 only. Before a run uses it, checkIdentity proves that the port answers this
//   run's nonce file AND that the process owning the listening port is the child this tool spawned.
// - The only process ever killed is a PID this tool recorded, after its command line is checked to be node running server.cjs.
// - A pristine tree is the hex-named store2 files only. restoreTree removes everything in save/ except the login files
//   (__password, __known_public_key_hashes.json), then copies the pristine tree back, so revision counters start again at 0.
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
export const SERVER_CJS = path.join(REPO_ROOT, 'server', 'node', 'server.cjs')
export const REQLOG_SHIM = path.join(HERE, 'c806-reqlog.cjs')
export const C806_ROOT = path.resolve(process.env.C806_ROOT ?? path.join(os.tmpdir(), 'risu-b715', 'b61', 'c806'))
export const PORT_RANGE = [6800, 6899]
export const KEEP_FILES = ['__password', '__known_public_key_hashes.json']
export const FORBIDDEN_PORTS = [6001, 6011, 6250, 6251, 9470]

const norm = (p) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p)
function isInside(p, root) {
  const a = norm(p), b = norm(root)
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}
/** A path under the scratch root; anything else (the repository above all) is refused. */
export function scratchPath(...parts) {
  const resolved = path.resolve(...parts)
  if (isInside(resolved, REPO_ROOT)) throw new Error('refusing a path inside the repository: ' + resolved)
  if (!isInside(resolved, C806_ROOT)) throw new Error('refusing a path outside the scratch root: ' + resolved)
  return resolved
}

export const dirsOf = (tag) => {
  const base = scratchPath(C806_ROOT, 'data', tag)
  return { base, srv: path.join(base, 'srv'), save: path.join(base, 'srv', 'save'), dist: path.join(base, 'srv', 'dist'), reqlog: path.join(base, 'requests.jsonl'), log: path.join(base, 'server.log'), pids: path.join(base, 'pids.json') }
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export function listenable(port) {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
  })
}

/** The first free port of the server range (the forbidden ports are outside it by construction; checked anyway). */
export async function pickFreePort(start = PORT_RANGE[0]) {
  for (let p = Math.max(start, PORT_RANGE[0]); p <= PORT_RANGE[1]; p++) {
    if (FORBIDDEN_PORTS.includes(p)) continue
    if (await listenable(p)) return p
  }
  throw new Error('no free port in ' + PORT_RANGE.join('-'))
}

function powershell(script) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 20000 }).trim()
}

/** The PID that owns the listening socket of `port` (127.0.0.1), or null. */
export function listenerPid(port) {
  const out = powershell(`$c = Get-NetTCPConnection -State Listen -LocalPort ${Number(port)} -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $c.OwningProcess }`)
  return out === '' ? null : Number(out)
}

/** The command line of a PID, or null. */
export function commandLineOf(pid) {
  const out = powershell(`(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(pid)}').CommandLine`)
  return out === '' ? null : out
}

/** Working set and peak working set of a PID in MiB (as storage-model/nodelist/bench.cjs reads it). */
export function serverRss(pid) {
  const o = powershell(`$p = Get-Process -Id ${Number(pid)}; '' + [math]::Round($p.WorkingSet64/1MB,1) + ' ' + [math]::Round($p.PeakWorkingSet64/1MB,1)`).split(' ')
  return { rssMiB: Number(o[0]), peakMiB: Number(o[1]) }
}

/**
 * The identity check: the port serves this run's nonce file from the scratch dist AND its listening process is `expectedPid`.
 * Throws with the reason; a dummy listener, another server or a stale server on the port is refused.
 */
export async function checkIdentity({ port, expectedPid, nonce, nonceName }) {
  // Fault knob for the T1d self-check: with it set the check accepts any listener, so selftest-identity must turn red.
  if (process.env.C806_FAULT === 'wrong-identity') return { port, pid: expectedPid }
  let body = null
  try {
    const r = await fetch(`http://127.0.0.1:${port}/${nonceName}`, { signal: AbortSignal.timeout(5000) })
    body = r.ok ? (await r.text()).trim() : null
  } catch (e) {
    throw new Error('identity: nothing answers the nonce on port ' + port + ' (' + (e.cause?.code ?? e.message) + ')')
  }
  if (body !== nonce) throw new Error('identity: port ' + port + ' does not serve this run\'s nonce')
  const owner = listenerPid(port)
  if (owner !== expectedPid) throw new Error('identity: port ' + port + ' is owned by pid ' + owner + ', expected ' + expectedPid)
  return { port, pid: owner }
}

export function sha256OfFile(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

/** Copies the measurement dist into the scratch srv folder (once per tag) and returns the index.html hash. */
export function prepareDist(tag, distSource) {
  const d = dirsOf(tag)
  scratchPath(distSource)
  fs.mkdirSync(d.srv, { recursive: true })
  if (!fs.existsSync(path.join(d.dist, 'index.html'))) fs.cpSync(distSource, d.dist, { recursive: true })
  return sha256OfFile(path.join(d.dist, 'index.html'))
}

/** save/ keeps only the login files, then receives a copy of the pristine tree. The server must be stopped. */
export function restoreTree(tag, pristine) {
  const d = dirsOf(tag)
  scratchPath(pristine)
  fs.mkdirSync(d.save, { recursive: true })
  let removed = 0
  for (const entry of fs.readdirSync(d.save)) {
    if (KEEP_FILES.includes(entry)) continue
    fs.rmSync(path.join(d.save, entry), { recursive: true, force: true })
    removed++
  }
  let copied = 0
  for (const entry of fs.readdirSync(pristine)) {
    fs.copyFileSync(path.join(pristine, entry), path.join(d.save, entry))
    copied++
  }
  return { removed, copied }
}

/** Hash over the sorted names of the store2 files and the commit key's bytes: a cheap drift check for a tree. */
export function commitKeyHash(saveDir) {
  const hex = Buffer.from('store2-commit', 'utf8').toString('hex')
  const file = path.join(saveDir, hex)
  return fs.existsSync(file) ? sha256OfFile(file) : null
}

/**
 * Starts the server. Returns { port, pid, child, dirs, nonce, stop() }; the identity check has passed.
 * `reqlog` false starts it without the log shim.
 */
export async function startServer({ tag, port, reqlog = true, env = {} }) {
  const d = dirsOf(tag)
  if (!fs.existsSync(path.join(d.dist, 'index.html'))) throw new Error('prepareDist first: ' + d.dist)
  fs.mkdirSync(d.save, { recursive: true })
  const nonce = randomBytes(12).toString('hex')
  const nonceName = 'c806-nonce-' + nonce.slice(0, 8) + '.txt'
  fs.writeFileSync(path.join(d.dist, nonceName), nonce + '\n')
  const chosen = port ?? await pickFreePort()
  if (FORBIDDEN_PORTS.includes(chosen) || chosen < PORT_RANGE[0] || chosen > PORT_RANGE[1]) throw new Error('port outside the server range: ' + chosen)
  if (!(await listenable(chosen))) throw new Error('port in use: ' + chosen)
  const args = [...(reqlog ? ['--require', REQLOG_SHIM] : []), SERVER_CJS]
  // a request log of an earlier server life is kept under its own name, so one file always covers one server life
  if (fs.existsSync(d.reqlog)) fs.renameSync(d.reqlog, d.reqlog.replace(/\.jsonl$/, '') + '-' + Date.now() + '.jsonl')
  const logFd = fs.openSync(d.log, 'a')
  const child = spawn(process.execPath, args, {
    cwd: d.srv, stdio: ['ignore', logFd, logFd], windowsHide: true,
    env: { ...process.env, PORT: String(chosen), HOST: '127.0.0.1', NODE_PATH: path.join(REPO_ROOT, 'node_modules'), C806_REQLOG: d.reqlog, ...env },
  })
  let exited = false
  child.on('exit', () => { exited = true })
  fs.writeFileSync(d.pids, JSON.stringify({ server: child.pid, port: chosen, tag, startedAt: new Date().toISOString() }) + '\n')
  const t0 = Date.now()
  let ready = false
  while (Date.now() - t0 < 60000 && !exited) {
    if (!(await listenable(chosen))) { ready = true; break }
    await sleep(100)
  }
  if (!ready) { try { child.kill() } catch {} throw new Error('the server did not start; see ' + d.log) }
  try {
    await checkIdentity({ port: chosen, expectedPid: child.pid, nonce, nonceName })
  } catch (e) {
    try { child.kill() } catch {}
    throw e
  }
  return {
    port: chosen, pid: child.pid, child, dirs: d, nonce, startMs: Date.now() - t0, baseUrl: `http://127.0.0.1:${chosen}`,
    async stop() {
      if (exited) return
      child.kill()
      const w0 = Date.now()
      while (!exited && Date.now() - w0 < 10000) await sleep(100)
    },
  }
}

/** Stops the recorded server PID after checking it is a node server.cjs and still the listener. */
export function stopRecorded(tag) {
  const d = dirsOf(tag)
  if (!fs.existsSync(d.pids)) return { stopped: false, reason: 'no pids.json' }
  const rec = JSON.parse(fs.readFileSync(d.pids, 'utf8'))
  const cmd = commandLineOf(rec.server)
  if (cmd === null) return { stopped: false, reason: 'process already gone' }
  if (!/node/i.test(cmd) || !cmd.includes('server.cjs')) return { stopped: false, reason: 'refused: pid ' + rec.server + ' is not node server.cjs: ' + cmd }
  // a recycled PID that runs another server.cjs is not ours: the recorded port must still be owned by the recorded PID
  const owner = listenerPid(rec.port)
  if (owner !== rec.server) return { stopped: false, reason: 'refused: port ' + rec.port + ' is owned by pid ' + owner + ', not the recorded ' + rec.server }
  process.kill(rec.server)
  return { stopped: true, pid: rec.server }
}

async function selftestIdentity() {
  // T1d: a dummy listener on a free port, started by this process, must be refused by the identity check.
  const port = await pickFreePort()
  const dummy = net.createServer((s) => s.end('HTTP/1.1 200 OK\r\ncontent-length: 4\r\n\r\nnope'))
  await new Promise(r => dummy.listen(port, '127.0.0.1', r))
  let refused = null
  try {
    await checkIdentity({ port, expectedPid: process.pid + 1, nonce: 'x', nonceName: 'c806-nonce-x.txt' })
  } catch (e) { refused = String(e.message) }
  dummy.close()
  console.log(JSON.stringify({ selftest: 'identity', refused: refused !== null, reason: refused }))
  if (refused === null) process.exit(1)
}

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const cmd = process.argv[2]
  if (cmd === 'start') {
    const tag = arg('--tag'), dist = arg('--dist'), tree = arg('--tree')
    if (!tag || !dist) { console.error('usage: start --tag <t> --dist <dir> [--tree <dir>] [--port <n>]'); process.exit(2) }
    console.log('dist index.html sha256 ' + prepareDist(tag, dist))
    if (tree) console.log('restore ' + JSON.stringify(restoreTree(tag, tree)))
    const s = await startServer({ tag, port: arg('--port') ? Number(arg('--port')) : undefined })
    console.log('server pid ' + s.pid + ' port ' + s.port + ' start ' + s.startMs + ' ms')
    s.child.on('exit', () => process.exit(0))
  } else if (cmd === 'stop') {
    console.log(JSON.stringify(stopRecorded(arg('--tag'))))
  } else if (cmd === 'restore') {
    console.log(JSON.stringify(restoreTree(arg('--tag'), arg('--tree'))))
  } else if (cmd === 'selftest-identity') {
    await selftestIdentity()
  } else {
    console.error('commands: start, stop, restore, selftest-identity')
    process.exit(2)
  }
}

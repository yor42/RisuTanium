// node Agents/Tools/chatshell-cdp/tests/lib.accept.mjs
// Acceptance test of the PC harness rules: where output may go, which hosts the launch flags block, that argument errors
// fail before any CDP connection, and that launch-chrome never hands over a browser it did not start. No Chrome and no
// device: every child process talks to a closed port, a scratch server, or a binary that is not Chrome.
// Env: CHATSHELL_CDP_DIR (points the tests at another copy of the tool folder), CHATSHELL_REPO_ROOT (the checkout whose
// node_modules and path rules apply), CHATSHELL_ACCEPT_SCRATCH (scratch folder; default: a new folder under the OS temp dir).
// Plain asserts print PASS/FAIL/SKIP; exit 0 only if every assert holds. Run with node, never through vitest.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOL = path.resolve(process.env.CHATSHELL_CDP_DIR || path.join(HERE, '..'))
const REPO = path.resolve(process.env.CHATSHELL_REPO_ROOT || path.join(HERE, '..', '..', '..', '..'))
const SCRATCH = process.env.CHATSHELL_ACCEPT_SCRATCH || fs.mkdtempSync(path.join(os.tmpdir(), 'chatshell-accept-'))
fs.mkdirSync(SCRATCH, { recursive: true })

let failures = 0
const check = (ok, name, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : (detail ? ' :: ' + detail : '')))
  if (!ok) failures++
}
const skip = (name, why) => console.log('SKIP ' + name + ' :: ' + why)
const note = (e) => String(e && e.message ? e.message : e).slice(0, 200)

if (!fs.existsSync(path.join(TOOL, 'lib.mjs'))) {
  console.log('FAIL the tool does not exist: ' + path.join(TOOL, 'lib.mjs'))
  process.exit(1)
}

// Redirect the OS temp dir for this process and every child, so a default output location never touches the real one.
const TMPHOME = path.join(SCRATCH, 'tmp-home')
fs.mkdirSync(TMPHOME, { recursive: true })
process.env.TEMP = TMPHOME; process.env.TMP = TMPHOME; process.env.TMPDIR = TMPHOME
process.env.CHATSHELL_CDP_DIR = TOOL
process.env.CHATSHELL_REPO_ROOT = REPO
delete process.env.HARNESS_OUT
delete process.env.HARNESS_CDP

const inside = (p, root) => {
  const norm = (s) => process.platform === 'win32' ? path.resolve(s).toLowerCase() : path.resolve(s)
  const a = norm(p), b = norm(root)
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}
const listing = (dir) => {
  const rows = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name)
      if (e.isDirectory()) { rows.push(path.relative(dir, full) + '/'); walk(full) } else rows.push(path.relative(dir, full) + ':' + fs.statSync(full).size)
    }
  }
  walk(dir)
  return rows.sort().join('\n')
}
const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer()
  s.once('error', reject)
  s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) })
})
const runNode = (script, args, env = {}, timeoutMs = 20000) => new Promise((resolve) => {
  const t0 = Date.now()
  const child = spawn(process.execPath, [script, ...args], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let out = '', err = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { err += d })
  const timer = setTimeout(() => { child.kill() }, timeoutMs)
  child.on('close', (code, signal) => { clearTimeout(timer); resolve({ status: code, signal, stdout: out, stderr: err, ms: Date.now() - t0 }) })
})
const rm = (p) => fs.rmSync(p, { recursive: true, force: true })

const TOOL_LISTING_AT_START = listing(TOOL)

const lib = await import(pathToFileURL(path.join(TOOL, 'lib.mjs')).href).catch((e) => { check(false, 'lib.mjs imports', note(e)); return null })
if (!lib) process.exit(1)

// T1: the default output location is under the OS temp dir, never in the checkout or the tool folder.
try {
  const d = lib.outDir()
  check(inside(d, TMPHOME) && !inside(d, REPO) && !inside(d, TOOL) && path.isAbsolute(d), 'T1 default outDir is under the OS temp dir, outside the checkout and the tool folder', d)
} catch (e) { check(false, 'T1 default outDir', note(e)) }

// T2: an output dir inside the checkout or the tool folder is refused, through the argument and through HARNESS_OUT.
{
  const refused = [
    ['the checkout root', REPO],
    ['a checkout subdirectory', path.join(REPO, 'Agents')],
    ['the tool folder', TOOL],
    ['a tool subdirectory', path.join(TOOL, 'tests')]
  ]
  if (process.platform === 'win32') refused.push(['the upper-cased checkout root', REPO.toUpperCase()])
  else skip('T2 upper-cased checkout root', 'case-insensitive matching only applies on a case-insensitive filesystem')
  for (const [label, dir] of refused) {
    let viaArg = false, viaEnv = false
    try { lib.outDir(dir) } catch { viaArg = true }
    process.env.HARNESS_OUT = dir
    try { lib.outDir() } catch { viaEnv = true }
    delete process.env.HARNESS_OUT
    check(viaArg && viaEnv, 'T2 outDir refuses ' + label, `viaArg=${viaArg} viaEnv=${viaEnv}`)
  }
}

// T3: a scratch out dir is returned as an absolute path and created.
try {
  const want = path.join(SCRATCH, 't3', 'deep', 'out')
  const got = lib.outDir(want)
  check(got === path.resolve(want) && fs.statSync(got).isDirectory(), 'T3 outDir returns the absolute scratch path and creates it', got)
} catch (e) { check(false, 'T3 outDir scratch', note(e)) }

// T4: the host rules map the mock host and send every real service host nowhere.
{
  const rules = lib.hostRules().split(',').map((s) => s.trim().split(/\s+/))
  const target = (host) => rules.filter((r) => r[0] === 'MAP' && r[1] === host).map((r) => r[2])
  check(JSON.stringify(target('mock.test')) === JSON.stringify(['127.0.0.1']), 'T4 mock.test maps to 127.0.0.1', JSON.stringify(target('mock.test')))
  for (const host of ['*.risuai.xyz', 'risuai.xyz', '*.risuai.net', 'risuai.net', 'discord.com', '*.discord.com', 'discord.gg', '*.discordapp.com']) {
    check(JSON.stringify(target(host)) === JSON.stringify(['~NOTFOUND']), 'T4 ' + host + ' is blocked with ~NOTFOUND', JSON.stringify(target(host)))
  }
}

// T5: chromeArgs carries the port, the rules as one element, a default profile outside the checkout; a repo profile throws.
try {
  const args = lib.chromeArgs({ port: 9999 })
  const rulesArg = args.filter((a) => a.startsWith('--host-resolver-rules='))
  const profileArg = args.find((a) => a.startsWith('--user-data-dir='))
  check(args.includes('--remote-debugging-port=9999'), 'T5 chromeArgs has the debugging port')
  check(rulesArg.length === 1 && rulesArg[0] === '--host-resolver-rules=' + lib.hostRules(), 'T5 the host rules are one argument element', JSON.stringify(rulesArg))
  const prof = profileArg ? profileArg.slice('--user-data-dir='.length) : ''
  check(prof !== '' && inside(prof, TMPHOME) && !inside(prof, REPO) && !inside(prof, TOOL), 'T5 the default profile is outside the checkout and the tool folder', prof)
  check(args.includes('--no-first-run') && args.includes('--no-default-browser-check'), 'T5 chromeArgs skips first-run prompts')
  const keepVisible = ['--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling']
  check(keepVisible.every((a) => args.includes(a)), 'T5 chromeArgs keeps a covered window visible and unthrottled', JSON.stringify(keepVisible.filter((a) => !args.includes(a))))
  for (const [label, dir] of [['the checkout', path.join(REPO, 'Agents', 'chrome-profile-probe')], ['the tool folder', path.join(TOOL, 'chrome-profile-probe')]]) {
    let threw = false
    try { lib.chromeArgs({ port: 9999, profile: dir }) } catch { threw = true }
    check(threw && !fs.existsSync(dir), 'T5 a profile inside ' + label + ' is refused and not created')
  }
} catch (e) { check(false, 'T5 chromeArgs', note(e)) }

// T6: importing the module does no I/O, and ws resolves inside the checkout's node_modules.
{
  const never = path.join(SCRATCH, 't6-never')
  const t6tmp = path.join(SCRATCH, 't6-tmp')
  fs.mkdirSync(t6tmp, { recursive: true })
  const before = listing(TOOL)
  const probe = `import(${JSON.stringify(pathToFileURL(path.join(TOOL, 'lib.mjs')).href)}).then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })`
  const r = await new Promise((resolve) => {
    const c = spawn(process.execPath, ['--input-type=module', '-e', probe], { env: { ...process.env, HARNESS_OUT: never, TEMP: t6tmp, TMP: t6tmp, TMPDIR: t6tmp }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let err = ''
    c.stderr.on('data', (d) => { err += d })
    c.on('close', (code) => resolve({ code, err }))
  })
  check(r.code === 0, 'T6 lib.mjs imports in a fresh process', r.err.slice(0, 200))
  check(!fs.existsSync(never) && fs.readdirSync(t6tmp).length === 0 && listing(TOOL) === before, 'T6 importing lib.mjs creates no directory and no file')
  try {
    const real = fs.realpathSync(lib.wsPath)
    const nm = fs.realpathSync(path.join(REPO, 'node_modules'))
    check(inside(real, nm), 'T6 ws resolves inside the checkout node_modules', real)
  } catch (e) { check(false, 'T6 ws resolution', note(e)) }
}

// T7: an unknown scenario exits 2 quickly, before any CDP connection is attempted.
const closed = await freePort()
{
  const out = path.join(SCRATCH, 't7-out')
  const r = await runNode(path.join(TOOL, 'harness.mjs'), ['--scenario', 'NOPE', '--out', out], { HARNESS_CDP: String(closed) }, 5000)
  check(r.status === 2 && r.ms < 5000 && !/ECONNREFUSED|fetch failed/.test(r.stderr), 'T7 harness --scenario NOPE exits 2 before connecting', `status=${r.status} ms=${r.ms} err=${r.stderr.slice(0, 160)}`)
  check(!fs.existsSync(out), 'T7 a rejected scenario creates no out dir')
}

// T8: an out dir inside the checkout exits exactly 2 before connecting.
{
  const r = await runNode(path.join(TOOL, 'harness.mjs'), ['--scenario', 'H7', '--out', path.join(REPO, 'Agents')], { HARNESS_CDP: String(closed) }, 10000)
  check(r.status === 2 && !/ECONNREFUSED|fetch failed/.test(r.stderr), 'T8 harness --out inside the checkout exits 2 before connecting', `status=${r.status} err=${r.stderr.slice(0, 160)}`)
}

// T9: a run against a closed port fails, and no run so far has left anything in the tool folder.
{
  const out = path.join(SCRATCH, 't9-out')
  const r = await runNode(path.join(TOOL, 'harness.mjs'), ['--scenario', 'H7', '--out', out], { HARNESS_CDP: String(closed) }, 15000)
  check(r.status !== 0 && r.status !== null, 'T9 harness against a closed port exits nonzero', `status=${r.status} signal=${r.signal}`)
  check(listing(TOOL) === TOOL_LISTING_AT_START, 'T9 the tool folder listing is unchanged after the harness runs')
}

// T14: launch-chrome refuses a busy port and a browser it did not start, and writes chrome.pid only after confirming one.
{
  const launch = path.join(TOOL, 'launch-chrome.mjs')
  const missing = path.join(SCRATCH, 'missing-chrome.exe')
  const noPid = (dir) => !fs.existsSync(path.join(dir, 'chrome.pid'))

  // (a) a port that already answers /json/version
  const portA = await freePort()
  const serverA = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end('{"Browser":"Chrome/0"}') })
  await new Promise((r) => serverA.listen(portA, '127.0.0.1', r))
  const outA = path.join(SCRATCH, 't14a')
  const ra = await runNode(launch, ['--port', String(portA), '--out', outA, '--profile', path.join(SCRATCH, 't14-profile')], { CHROME_PATH: missing }, 20000)
  await new Promise((r) => serverA.close(r))
  check(ra.status === 3 && noPid(outA), 'T14a a port answering /json/version exits 3', `status=${ra.status} err=${ra.stderr.slice(0, 160)}`)

  // (b) a port held by a listener that never answers HTTP
  const portB = await freePort()
  const socketsB = []
  const serverB = net.createServer((sock) => { socketsB.push(sock); sock.on('error', () => {}) })
  await new Promise((r) => serverB.listen(portB, '127.0.0.1', r))
  const outB = path.join(SCRATCH, 't14b')
  const rb = await runNode(launch, ['--port', String(portB), '--out', outB, '--profile', path.join(SCRATCH, 't14-profile')], { CHROME_PATH: missing }, 20000)
  socketsB.forEach((s) => s.destroy())
  await new Promise((r) => serverB.close(r))
  check(rb.status === 3 && noPid(outB), 'T14b a port held by a bare listener exits 3', `status=${rb.status} err=${rb.stderr.slice(0, 160)}`)

  // (c) a free port with a binary that is not Chrome: the spawned child must not be accepted
  const portC = await freePort()
  const outC = path.join(SCRATCH, 't14c')
  const rc = await runNode(launch, ['--port', String(portC), '--out', outC, '--profile', path.join(SCRATCH, 't14-profile')], { CHROME_PATH: process.execPath }, 40000)
  check(rc.status === 5 && noPid(outC), 'T14c a spawned child that is not Chrome exits 5 and writes no chrome.pid', `status=${rc.status} err=${rc.stderr.slice(0, 160)}`)

  // (d) CHROME_PATH set but missing: exit 4, no fallback to an installed Chrome
  const portD = await freePort()
  const outD = path.join(SCRATCH, 't14d')
  const rd = await runNode(launch, ['--port', String(portD), '--out', outD, '--profile', path.join(SCRATCH, 't14-profile')], { CHROME_PATH: missing }, 20000)
  check(rd.status === 4 && noPid(outD), 'T14d a missing CHROME_PATH exits 4 without a fallback', `status=${rd.status} err=${rd.stderr.slice(0, 160)}`)

  // (e) an out dir or a profile inside the checkout is refused before anything starts
  const portE = await freePort()
  const re1 = await runNode(launch, ['--port', String(portE), '--out', path.join(REPO, 'Agents')], { CHROME_PATH: missing }, 20000)
  const re2 = await runNode(launch, ['--port', String(portE), '--out', path.join(SCRATCH, 't14e'), '--profile', path.join(REPO, 'Agents', 'chrome-profile-probe')], { CHROME_PATH: missing }, 20000)
  check(re1.status === 2 && re2.status === 2 && !fs.existsSync(path.join(REPO, 'Agents', 'chrome-profile-probe')), 'T14e an out dir or a profile inside the checkout exits 2', `out=${re1.status} profile=${re2.status}`)
}

if (failures === 0) rm(SCRATCH)
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILED')
process.exit(failures === 0 ? 0 : 1)

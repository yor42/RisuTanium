// node Agents/Tools/chatshell-cdp/tests/device-kit.accept.mjs
// Acceptance test of the observer-free device kit: the serial and the CDP port are mandatory, argument errors fail before
// any directory, adb call or CDP connection, an output path inside the checkout is refused, and the run script fails closed
// in its second phase (adb server, wake, app absent, a failed trial, forward removal). No device and no Chrome: adb and node
// are stand-ins on PATH that log their arguments, and every child process talks to a closed port or a scratch folder.
// Env: CHATSHELL_CDP_DIR (points the tests at another copy of the tool folder), CHATSHELL_REPO_ROOT (the checkout whose
// node_modules and device/lib.ps1 apply), CHATSHELL_ACCEPT_SCRATCH (scratch folder; default: a new folder under the OS temp dir).
// Plain asserts print PASS/FAIL/SKIP; exit 0 only if every assert holds. Run with node, never through vitest.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOL = path.resolve(process.env.CHATSHELL_CDP_DIR || path.join(HERE, '..'))
const REPO = path.resolve(process.env.CHATSHELL_REPO_ROOT || path.join(HERE, '..', '..', '..', '..'))
const DEVICE = path.join(TOOL, 'device')
const SCRATCH = process.env.CHATSHELL_ACCEPT_SCRATCH || fs.mkdtempSync(path.join(os.tmpdir(), 'chatshell-device-accept-'))
fs.mkdirSync(SCRATCH, { recursive: true })

let failures = 0
const check = (ok, name, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : (detail ? ' :: ' + detail : '')))
  if (!ok) failures++
}
const skip = (name, why) => console.log('SKIP ' + name + ' :: ' + why)
const note = (e) => String(e && e.message ? e.message : e).slice(0, 200)

if (!fs.existsSync(path.join(DEVICE, 'lib.mjs'))) {
  console.log('FAIL the device kit does not exist: ' + path.join(DEVICE, 'lib.mjs'))
  process.exit(1)
}

const TMPHOME = path.join(SCRATCH, 'tmp-home')
fs.mkdirSync(TMPHOME, { recursive: true })
process.env.TEMP = TMPHOME; process.env.TMP = TMPHOME; process.env.TMPDIR = TMPHOME
process.env.CHATSHELL_CDP_DIR = TOOL
process.env.CHATSHELL_REPO_ROOT = REPO
for (const k of ['HARNESS_OUT', 'HARNESS_CDP', 'HARNESS_SERIAL', 'HARNESS_ADB']) delete process.env[k]

const FAKE_SERIAL = 'FAKE-0000'
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
const run = (cmd, args, env = {}, timeoutMs = 20000) => new Promise((resolve) => {
  const t0 = Date.now()
  const child = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let out = '', err = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { err += d })
  child.on('error', (e) => { err += String(e) })
  const timer = setTimeout(() => { child.kill() }, timeoutMs)
  child.on('close', (code, signal) => { clearTimeout(timer); resolve({ status: code, signal, stdout: out, stderr: err, ms: Date.now() - t0 }) })
})
const runNode = (script, args, env, timeoutMs) => run(process.execPath, [script, ...args], env, timeoutMs)
const runPwsh = (script, args, env, timeoutMs) => run('pwsh', ['-NoProfile', '-NonInteractive', '-File', script, ...args], env, timeoutMs)
const rm = (p) => fs.rmSync(p, { recursive: true, force: true })
const both = (r) => r.stdout + '\n' + r.stderr
const readLines = (file) => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []
const windows = process.platform === 'win32'
const psq = (p) => "'" + p.replace(/'/g, "''") + "'"

const TOOL_LISTING_AT_START = listing(TOOL)

// Stand-ins for adb and node. The fake adb keeps a forward table in a state file, so the real forward helpers can run
// against it. The fake node only logs; FAKE_NODE_FAIL names the script whose run exits nonzero.
const FAKE = path.join(SCRATCH, 'fake')
fs.mkdirSync(FAKE, { recursive: true })
fs.writeFileSync(path.join(FAKE, 'fake-adb.mjs'), [
  "import fs from 'node:fs'",
  'const a = process.argv.slice(2)',
  'let serial = null',
  "if (a[0] === '-s') { serial = a[1]; a.splice(0, 2) }",
  "const mode = (process.env.FAKE_ADB_MODE || '').split(',')",
  'if (process.env.FAKE_ADB_LOG) fs.appendFileSync(process.env.FAKE_ADB_LOG, JSON.stringify({ serial, args: a }) + "\\n")',
  'const state = process.env.FAKE_ADB_STATE',
  "const rows = () => state && fs.existsSync(state) ? fs.readFileSync(state, 'utf8').split('\\n').filter(Boolean) : []",
  "const put = (r) => fs.writeFileSync(state, r.map((x) => x + '\\n').join(''))",
  "if (a[0] === 'start-server') process.exit(mode.includes('noserver') ? 1 : 0)",
  "if (a[0] === 'get-state') { console.log('device'); process.exit(0) }",
  "if (a[0] === 'shell' && /^input keyevent/.test(a[1] || '')) process.exit(mode.includes('wakefail') ? 1 : 0)",
  "if (a[0] === 'shell' && a[1] === 'pidof') { if (mode.includes('noapp')) process.exit(1); console.log('4321'); process.exit(0) }",
  "if (a[0] === 'forward' && a[1] === '--list') { console.log(rows().join('\\n')); process.exit(0) }",
  "if (a[0] === 'forward' && a[1] === '--no-rebind') { put([...rows(), serial + ' ' + a[2] + ' ' + a[3]]); process.exit(0) }",
  "if (a[0] === 'forward' && a[1] === '--remove') { put(rows().filter((r) => r.split(' ')[1] !== a[2])); process.exit(0) }",
  'process.exit(0)',
  ''
].join('\n'))
fs.writeFileSync(path.join(FAKE, 'fake-node.mjs'), [
  "import fs from 'node:fs'",
  "import path from 'node:path'",
  'const a = process.argv.slice(2)',
  "fs.appendFileSync(process.env.FAKE_NODE_LOG, JSON.stringify({ script: path.basename(a[0]), args: a.slice(1), serial: process.env.HARNESS_SERIAL, cdp: process.env.HARNESS_CDP, out: process.env.HARNESS_OUT, adb: process.env.HARNESS_ADB }) + '\\n')",
  "process.exit(process.env.FAKE_NODE_FAIL && path.basename(a[0]) === process.env.FAKE_NODE_FAIL ? 3 : 0)",
  ''
].join('\n'))
const ADB_CMD = path.join(FAKE, 'adb.cmd')
fs.writeFileSync(ADB_CMD, '@"%FAKE_REAL_NODE%" "%~dp0fake-adb.mjs" %*\r\n')
fs.writeFileSync(path.join(FAKE, 'node.cmd'), '@"%FAKE_REAL_NODE%" "%~dp0fake-node.mjs" %*\r\n')
const pathKey = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') || 'PATH'
const fakeEnv = (extra = {}) => ({ [pathKey]: FAKE + path.delimiter + process.env[pathKey], FAKE_REAL_NODE: process.execPath, ...extra })

const lib = await import(pathToFileURL(path.join(DEVICE, 'lib.mjs')).href).catch((e) => { check(false, 'device/lib.mjs imports', note(e)); return null })
if (!lib) process.exit(1)

// T10: safeName admits plain names only; the serial and the port have no default.
{
  for (const ok of ['smoke', 'T1', 'r3-fling_2', 'a'.repeat(40)]) {
    let v = null
    try { v = lib.safeName(ok) } catch (e) { v = note(e) }
    check(v === ok, 'T10 safeName admits ' + ok.slice(0, 12), String(v))
  }
  for (const bad of ['..', '.', 'a/b', 'a\\b', '', 'a b', 'a'.repeat(41), 'x:y']) {
    let threw = false
    try { lib.safeName(bad) } catch { threw = true }
    check(threw, 'T10 safeName rejects ' + JSON.stringify(bad.slice(0, 12)))
  }
  const withEnv = (k, v, fn) => {
    const old = process.env[k]
    if (v === undefined) delete process.env[k]; else process.env[k] = v
    try { return fn() } finally { if (old === undefined) delete process.env[k]; else process.env[k] = old }
  }
  const throws = (fn) => { try { fn(); return false } catch { return true } }
  check(throws(() => withEnv('HARNESS_CDP', undefined, () => lib.devicePort())), 'T10 devicePort has no default port')
  for (const bad of ['abc', '80', '70000', '']) check(throws(() => withEnv('HARNESS_CDP', bad, () => lib.devicePort())), 'T10 devicePort rejects ' + JSON.stringify(bad))
  check(withEnv('HARNESS_CDP', '9461', () => lib.devicePort()) === 9461, 'T10 devicePort returns the number')
  check(throws(() => withEnv('HARNESS_SERIAL', undefined, () => lib.requireSerial())), 'T10 requireSerial has no default serial')
  for (const bad of ['', '-s', 'a b', 'a;b']) check(throws(() => withEnv('HARNESS_SERIAL', bad, () => lib.requireSerial())), 'T10 requireSerial rejects ' + JSON.stringify(bad))
  check(withEnv('HARNESS_SERIAL', FAKE_SERIAL, () => lib.requireSerial()) === FAKE_SERIAL, 'T10 requireSerial returns the serial')
  check(withEnv('HARNESS_ADB', undefined, () => lib.adbExe()) === 'adb' && withEnv('HARNESS_ADB', 'x-adb', () => lib.adbExe()) === 'x-adb', 'T10 adbExe is HARNESS_ADB or adb')
}

// T13: sharp is found through the checkout (a transitive dependency, so not a plain require), and analyze.mjs runs on a
// synthetic frame: the self-check shift of 37 px is estimated exactly.
{
  let sharp = null
  try { sharp = lib.loadSharp() } catch (e) { check(false, 'T13 loadSharp', note(e)) }
  check(typeof sharp === 'function', 'T13 loadSharp returns a function')
  if (typeof sharp === 'function') {
    const out = path.join(SCRATCH, 't13-out')
    const dir = path.join(out, 'syn-t1')
    fs.mkdirSync(path.join(dir, 'frames'), { recursive: true })
    const W = 200, H = 600
    const px = Buffer.alloc(W * H)
    let seed = 12345
    for (let i = 0; i < px.length; i++) { seed = (seed * 1103515245 + 12345) & 0x7fffffff; px[i] = (seed >> 8) & 255 }
    await sharp(px, { raw: { width: W, height: H, channels: 1 } }).jpeg({ quality: 95 }).toFile(path.join(dir, 'frames', 'f0000.jpg'))
    fs.writeFileSync(path.join(dir, 'raw.json'), JSON.stringify({
      build: 'syn', trial: 't1', mode: 'still', params: [0], clk: [{ h0: 0, h1: 0, d: 0 }], ra: { iw: W, hostTop: 0, hostBottom: H, st: 0, nMsg: 0, mi: 0 }, ra2: null,
      jumpT: 0, swipeT: null, polls: [], pollCount: 0, detect: null, b500: null, b1000: null, frameMeta: [{ name: 'f0000.jpg', ts: 0, hostT: 0 }]
    }))
    const r = await runNode(path.join(DEVICE, 'analyze.mjs'), ['syn', 't1'], { HARNESS_OUT: out }, 60000)
    let est = null
    try { est = JSON.parse(fs.readFileSync(path.join(dir, 'analysis.json'), 'utf8')).selfCheck.estimated } catch { est = null }
    check(r.status === 0 && est === 37, 'T13 analyze.mjs estimates the synthetic 37 px shift under HARNESS_OUT', `status=${r.status} est=${est} err=${r.stderr.slice(0, 160)}`)
  }
}

// T12: a device script with no CDP port exits nonzero and names HARNESS_CDP; against a closed port it fails and leaves
// nothing behind; analyze and obsfree refuse a name or an out dir that escapes.
const closed = await freePort()
{
  for (const s of ['coldtap.mjs', 'closeside.mjs']) {
    const none = await runNode(path.join(DEVICE, s), ['30', '45'], {}, 10000)
    check(none.status !== 0 && none.status !== null && /HARNESS_CDP/.test(both(none)), 'T12 ' + s + ' with no HARNESS_CDP exits nonzero naming it', `status=${none.status} ${both(none).slice(0, 160)}`)
    const r = await runNode(path.join(DEVICE, s), ['30', '45'], { HARNESS_CDP: String(closed) }, 15000)
    check(r.status !== 0 && r.status !== null, 'T12 ' + s + ' against a closed port exits nonzero', `status=${r.status}`)
  }
  const out = path.join(SCRATCH, 't12-out')
  const base = { HARNESS_CDP: String(closed), HARNESS_SERIAL: FAKE_SERIAL, HARNESS_OUT: out }
  const r1 = await runNode(path.join(DEVICE, 'obsfree.mjs'), ['b', 't', 'still', '60'], base, 15000)
  check(r1.status !== 0 && r1.status !== 2 && r1.status !== null && !fs.existsSync(path.join(out, 'b-t')), 'T12 obsfree against a closed port fails after validation and leaves no trial folder', `status=${r1.status} err=${r1.stderr.slice(0, 160)}`)
  const r2 = await runNode(path.join(DEVICE, 'obsfree.mjs'), ['b', 't', 'still', '60'], { ...base, HARNESS_SERIAL: '', HARNESS_OUT: out + '-noserial' }, 15000)
  check(r2.status === 2 && !fs.existsSync(out + '-noserial'), 'T12 obsfree with no serial exits 2 and creates nothing', `status=${r2.status}`)
  const r3 = await runNode(path.join(DEVICE, 'obsfree.mjs'), ['b', 't', 'still', '60'], { ...base, HARNESS_CDP: '', HARNESS_OUT: out + '-noport' }, 15000)
  check(r3.status === 2 && !fs.existsSync(out + '-noport'), 'T12 obsfree with no CDP port exits 2 and creates nothing', `status=${r3.status}`)
  const r4 = await runNode(path.join(DEVICE, 'obsfree.mjs'), ['b', 't', 'still', '60'], { ...base, HARNESS_OUT: path.join(REPO, 'Agents') }, 15000)
  check(r4.status === 2, 'T12 obsfree with an out dir inside the checkout exits 2', `status=${r4.status}`)
  const a1 = await runNode(path.join(DEVICE, 'analyze.mjs'), ['..', 't'], { HARNESS_OUT: out }, 15000)
  const a2 = await runNode(path.join(DEVICE, 'analyze.mjs'), ['b', 'a/b'], { HARNESS_OUT: out }, 15000)
  check(a1.status === 2 && a2.status === 2, 'T12 analyze rejects a build or trial name that escapes', `status=${a1.status},${a2.status}`)
  check(listing(TOOL) === TOOL_LISTING_AT_START, 'T12 the tool folder listing is unchanged after the device scripts run')
}

// T18: obsfree argument errors exit 2 before anything is created or connected, with a fake serial set.
{
  const out = path.join(SCRATCH, 't18-out')
  const env = { HARNESS_CDP: String(closed), HARNESS_SERIAL: FAKE_SERIAL, HARNESS_OUT: out }
  const cases = [
    ['fling with one number', ['b', 't', 'fling', '650']],
    ['an unknown mode', ['b', 't', 'wobble', '1']],
    ['a build name that escapes', ['..', 't', 'still', '60']],
    ['a still target that is not a number', ['b', 't', 'still', 'NaN']],
    ['a still without a target', ['b', 't', 'still']],
    ['a fling with a non-number', ['b', 't', 'fling', '650', '600', 'x', '150']],
    ['a trial name with a separator', ['b', 'a/b', 'still', '60']]
  ]
  for (const [label, args] of cases) {
    const r = await runNode(path.join(DEVICE, 'obsfree.mjs'), args, env, 10000)
    check(r.status === 2 && !/ECONNREFUSED|fetch failed/.test(r.stderr) && !fs.existsSync(out), 'T18 obsfree ' + label + ' exits 2 and creates nothing', `status=${r.status} err=${r.stderr.slice(0, 160)}`)
  }
}

if (!windows) {
  skip('T11, T15-T17, B1-B6', 'the run script uses the Windows handle API')
} else {
  const RUN = path.join(DEVICE, 'run-obsfree.ps1')
  const mk = (name) => {
    const dir = path.join(SCRATCH, name)
    fs.mkdirSync(dir, { recursive: true })
    return { dir, adbLog: path.join(dir, 'adb.log'), adbState: path.join(dir, 'adb.state'), nodeLog: path.join(dir, 'node.log') }
  }
  const caseEnv = (c, extra = {}) => fakeEnv({ FAKE_ADB_LOG: c.adbLog, FAKE_ADB_STATE: c.adbState, FAKE_NODE_LOG: c.nodeLog, ...extra })
  const quiet = (c) => readLines(c.adbLog).length === 0 && readLines(c.nodeLog).length === 0

  // T11: no serial means a nonzero exit that names Serial, and no out dir.
  {
    const c = mk('t11'); const out = path.join(c.dir, 'out')
    const r = await runPwsh(RUN, ['-Build', 'x', '-OutDir', out, '-AdbExe', ADB_CMD], caseEnv(c), 60000)
    check(r.status !== 0 && /Serial/.test(both(r)) && !fs.existsSync(out) && quiet(c), 'T11 no -Serial exits nonzero naming Serial and creates nothing', `status=${r.status} ${both(r).slice(0, 200)}`)
  }

  // T15: an unknown trial is refused in the first phase: no out dir, no adb call.
  for (const trials of ['NOPE', 'T1,NOPE']) {
    const c = mk('t15-' + trials.replace(/\W/g, '_')); const out = path.join(c.dir, 'out')
    const r = await runPwsh(RUN, ['-Serial', FAKE_SERIAL, '-Build', 'x', '-Trials', trials, '-OutDir', out, '-AdbExe', ADB_CMD], caseEnv(c), 60000)
    check(r.status !== 0 && /NOPE/.test(both(r)) && !fs.existsSync(out) && quiet(c), 'T15 -Trials ' + trials + ' exits nonzero naming NOPE, no out dir, no adb call', `status=${r.status} ${both(r).slice(0, 200)}`)
  }

  // T16: -PlanOnly under -File splits the comma list, prints the plan, exits 0 and creates nothing.
  {
    const c = mk('t16'); const out = path.join(c.dir, 'plan-out')
    const r = await runPwsh(RUN, ['-Serial', FAKE_SERIAL, '-Build', 'smoke', '-Trials', 'T1,F1', '-OutDir', out, '-AdbExe', ADB_CMD, '-PlanOnly'], caseEnv(c), 60000)
    let plan = null
    try { plan = JSON.parse(r.stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop()) } catch { plan = null }
    check(r.status === 0 && plan && JSON.stringify(plan.Trials) === '["T1","F1"]' && plan.Serial === FAKE_SERIAL && plan.Build === 'smoke', 'T16 -PlanOnly -Trials T1,F1 prints Trials ["T1","F1"] and exits 0', `status=${r.status} ${both(r).slice(0, 200)}`)
    check(plan && plan.PortMin === 9460 && plan.PortMax === 9469 && path.resolve(plan.OutDir) === path.resolve(out) && path.resolve(plan.AdbDir) === path.join(path.resolve(out), 'adb'), 'T16 the plan carries the default port range and the out dir', JSON.stringify(plan))
    check(!fs.existsSync(out) && quiet(c), 'T16 -PlanOnly creates no out dir and calls no adb (explicit scratch -OutDir)')
    const d = mk('t16-default')
    const r2 = await runPwsh(RUN, ['-Serial', FAKE_SERIAL, '-Build', 'smoke', '-Trials', 'T1', '-AdbExe', ADB_CMD, '-PlanOnly'], caseEnv(d), 60000)
    let plan2 = null
    try { plan2 = JSON.parse(r2.stdout.split(/\r?\n/).filter((l) => l.trim().startsWith('{')).pop()) } catch { plan2 = null }
    check(r2.status === 0 && plan2 && path.resolve(plan2.OutDir).toLowerCase().startsWith(path.resolve(TMPHOME).toLowerCase()) && !fs.existsSync(path.join(TMPHOME, 'chatshell-cdp')), 'T16 the default out dir is under the OS temp dir and -PlanOnly does not create it', JSON.stringify(plan2))
  }

  // T17: an out dir inside the checkout or the tool folder, or a build name that escapes, is refused before anything is created.
  {
    const refused = [
      ['an out dir in the tool folder', ['-OutDir', path.join(TOOL, 'out')], path.join(TOOL, 'out')],
      ['the upper-cased checkout root plus a name', ['-OutDir', path.join(REPO.toUpperCase(), 'x-probe-' + process.pid)], path.join(REPO, 'x-probe-' + process.pid)],
      ['a build name ..', ['-Build', '..'], null]
    ]
    for (const [label, extra, made] of refused) {
      const c = mk('t17-' + label.replace(/\W/g, '_'))
      const args = ['-Serial', FAKE_SERIAL, '-Build', 'x', '-Trials', 'T1', '-OutDir', path.join(c.dir, 'out'), '-AdbExe', ADB_CMD]
      for (let i = 0; i < extra.length; i += 2) { const k = args.indexOf(extra[i]); if (k >= 0) args[k + 1] = extra[i + 1]; else args.push(extra[i], extra[i + 1]) }
      // A path that exists before the run is not ours to judge or delete; one created by a broken guard is removed after the check.
      const pre = !!made && fs.existsSync(made)
      const r = await runPwsh(RUN, args, caseEnv(c), 60000)
      const created = !!made && !pre && fs.existsSync(made)
      if (created) rm(made)
      check(!pre && r.status !== 0 && !created && !fs.existsSync(path.join(c.dir, 'out')) && quiet(c), 'T17 ' + label + ' exits nonzero and creates nothing', `pre=${pre} status=${r.status} created=${created} ${both(r).slice(0, 200)}`)
    }
    check(listing(TOOL) === TOOL_LISTING_AT_START, 'T17 the tool folder listing is unchanged')
  }

  // Phase B: the run script fails closed. Each case has its own scratch, fake adb state and port; they run side by side.
  const phaseB = async (name, extraArgs, extraEnv) => {
    const c = mk(name)
    const port = await freePort()
    const out = path.join(c.dir, 'out')
    const args = ['-Serial', FAKE_SERIAL, '-Build', 'smoke', '-OutDir', out, '-AdbExe', ADB_CMD, '-PortMin', String(port), '-PortMax', String(port), ...extraArgs]
    const r = await runPwsh(RUN, args, caseEnv(c, extraEnv), 120000)
    return { c, r, port, out, adb: readLines(c.adbLog), node: readLines(c.nodeLog), fwd: fs.existsSync(c.adbState) ? fs.readFileSync(c.adbState, 'utf8').trim() : '' }
  }
  const [b1, b2, b3, b4, b5, b7] = await Promise.all([
    phaseB('b1', ['-Trials', 'T1'], { FAKE_ADB_MODE: 'noserver' }),
    phaseB('b2', ['-Trials', 'T1'], { FAKE_ADB_MODE: 'wakefail' }),
    phaseB('b3', ['-Trials', 'T1'], { FAKE_ADB_MODE: 'noapp' }),
    phaseB('b4', ['-Trials', 'T1,T2'], { FAKE_NODE_FAIL: 'obsfree.mjs' }),
    phaseB('b5', ['-Trials', 'T4,F1'], {}),
    phaseB('b7', ['-Trials', 'T1,T2'], { FAKE_NODE_FAIL: 'coldtap.mjs' })
  ])
  const sub = (adb, w) => adb.filter((x) => x.args.join(' ').includes(w))

  // B1: the adb server does not start, so nothing else runs.
  check(b1.r.status !== 0 && b1.adb.length === 1 && b1.adb[0].args[0] === 'start-server' && b1.node.length === 0, 'B1 a failed adb start exits nonzero after that single call and runs no node', `status=${b1.r.status} adb=${JSON.stringify(b1.adb.map((x) => x.args))}`)

  // B2: a failed wake stops before the app is touched.
  check(b2.r.status !== 0 && sub(b2.adb, 'KEYCODE_WAKEUP').length === 1 && sub(b2.adb, 'force-stop').length === 0 && b2.node.length === 0, 'B2 a failed wake exits nonzero before force-stop and runs no node', `status=${b2.r.status} adb=${JSON.stringify(b2.adb.map((x) => x.args))}`)

  // B3: the app is not running after the start, so no forward is made and no tap is sent.
  check(b3.r.status !== 0 && /app/i.test(both(b3.r)) && sub(b3.adb, 'forward --no-rebind').length === 0 && b3.node.length === 0, 'B3 an absent app exits nonzero with no forward and no tap', `status=${b3.r.status} node=${b3.node.length} ${both(b3.r).slice(0, 200)}`)

  // B4: the first failed trial stops the series; the forward is still removed.
  check(b4.r.status !== 0 && b4.node.filter((x) => x.script === 'obsfree.mjs').length === 1 && b4.node.filter((x) => x.script === 'analyze.mjs').length === 0 && b4.fwd === '' && sub(b4.adb, 'forward --remove').length === 1, 'B4 a failed trial stops the series, skips analyze and removes the forward', `status=${b4.r.status} node=${JSON.stringify(b4.node.map((x) => x.script))} fwd=${b4.fwd}`)

  // B5: a full series passes the serial, port, out dir and adb to every node call, and removes its forward at the end.
  {
    const scripts = b5.node.map((x) => x.script + ' ' + x.args.join(' '))
    const want = ['coldtap.mjs 30 45', 'coldtap.mjs 40 88', 'closeside.mjs ', 'obsfree.mjs smoke T4 still 0', 'analyze.mjs smoke T4', 'obsfree.mjs smoke F1 fling 650 600 1500 150', 'analyze.mjs smoke F1']
    check(b5.r.status === 0 && want.every((w) => scripts.includes(w)), 'B5 a two-trial series runs open, obsfree and analyze for each, with the table values', `status=${b5.r.status} ${both(b5.r).slice(0, 200)} scripts=${JSON.stringify(scripts)}`)
    const ob = b5.node.filter((x) => x.script === 'obsfree.mjs')
    check(ob.length === 2 && ob.every((x) => x.serial === FAKE_SERIAL && x.cdp === String(b5.port) && path.resolve(x.out) === path.resolve(b5.out) && x.adb === ADB_CMD), 'B5 obsfree receives the serial, the forwarded port, the out dir and the adb path', JSON.stringify(ob))
    check(b5.fwd === '' && sub(b5.adb, 'forward --remove tcp:' + b5.port).length >= 1 && sub(b5.adb, '--no-rebind').every((x) => x.serial === FAKE_SERIAL), 'B5 the forward is removed at the end and every adb call carries the serial', `fwd=${b5.fwd}`)
    check(b5.adb.filter((x) => x.args[0] !== 'start-server').every((x) => x.serial === FAKE_SERIAL), 'B5 every device adb call names the serial')
  }

  // B7: a failed tap step stops the series before the trial runs, and the forward is still removed.
  check(b7.r.status !== 0 && b7.node.length === 1 && b7.node[0].script === 'coldtap.mjs' && b7.fwd === '' && sub(b7.adb, 'forward --remove').length === 1, 'B7 a failed tap step stops the series before obsfree and removes the forward', `status=${b7.r.status} node=${JSON.stringify(b7.node.map((x) => x.script))} fwd=${b7.fwd}`)

  // B6: open-fresh clears a stale HARNESS_CDP first and leaves it clear when the app is absent.
  {
    const c = mk('b6')
    const script = [
      '$ErrorActionPreference = "Stop"',
      `. ${psq(path.join(REPO, 'Agents', 'Tools', 'device', 'lib.ps1'))}`,
      `. ${psq(path.join(DEVICE, 'open-fresh.ps1'))}`,
      `$null = Initialize-Adb ${psq(path.join(c.dir, 'adb'))} ${psq(ADB_CMD)}`,
      '$env:HARNESS_CDP = "65000"',
      '$f = New-CdpForward "' + FAKE_SERIAL + '" "io.github.yor42.risutanium" 40000 40000',
      'try { Open-ObsFreeFreshChat -Serial "' + FAKE_SERIAL + '" -Fwd $f; "NOTHROW" } catch { "THREW" }',
      '"CDP=[" + $env:HARNESS_CDP + "]"'
    ].join('\n')
    const file = path.join(c.dir, 'b6.ps1')
    fs.writeFileSync(file, script + '\n')
    const r = await run('pwsh', ['-NoProfile', '-NonInteractive', '-File', file], caseEnv(c, { FAKE_ADB_MODE: 'noapp' }), 60000)
    check(/THREW/.test(r.stdout) && /CDP=\[\]/.test(r.stdout) && readLines(c.nodeLog).length === 0, 'B6 an absent app throws, leaves HARNESS_CDP empty and sends no tap', both(r).slice(0, 300))
  }
}

if (failures === 0) rm(SCRATCH)
console.log(failures === 0 ? 'ALL PASS' : failures + ' FAILED')
process.exit(failures === 0 ? 0 : 1)

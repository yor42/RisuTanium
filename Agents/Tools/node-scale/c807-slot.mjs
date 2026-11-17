// CHORE-807 stage 0: the full-run slot library of the c807 measurement tools, and a slot-holding command runner.
//
//   node c807-slot.mjs run --which a|b|any --text <owner text> [--max-wait-min N] [--record <json file>] -- <command> [args...]
//   node c807-slot.mjs selfcheck        (checks T0a-T0c on a scratch slot root, then the three mutants on scratch copies)
//   node c807-slot.mjs checks           (the clean checks only; exit 1 when one fails)
//
// Library use: import { acquire } from './c807-slot.mjs'; const slot = await acquire({ which: 'a', text }); ...; slot.release().
// Invariants:
// - Slot A is %TEMP%\risu-b715\fullrun-slot (builds), slot B is fullrun-slot-b; a slot is held by a directory whose owner.txt carries
//   our token (text, pid, random nonce, time). A slot directory without owner.txt counts as held: it is never taken and never
//   removed, and acquire stops with a message after maxWaitMs (default 10 minutes) so the orchestrator decides.
// - At least 95 s pass between a release and the next acquire of the same slot (MC-2036). The last release is persisted in
//   %TEMP%\risu-b715\c807-lastrelease-<a|b>.json, outside the slot directories, so a later process sees it. A slot that was seen held
//   and then gone while waiting is dated at the moment it was seen gone. A release by another lane's tool that writes no file and
//   that we did not observe is invisible; that limit is stated in the run record (LIMIT_NOTE).
// - release removes the slot directory only while owner.txt still equals our token; a foreign owner is left untouched. It also runs
//   on exit, SIGINT and SIGTERM.
// - The other slot's owner.txt is recorded at acquire and at release as noise provenance.
// - C807_SLOT_ROOT and C807_SLOT_GAP_MS replace the root and the gap only when the root lies under the c807 run root; the real
//   %TEMP%\risu-b715 root refuses them.
// Self-check mutants (scratch copies only, never the repository file): steal-slot (release ignores the token), gap-in-memory (the
// last release is not persisted), steal-ownerless (an ownerless slot is removed and taken).
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const TEMP_ROOT = path.join(os.tmpdir(), 'risu-b715')
const RUN_ROOT = path.join(TEMP_ROOT, 'b61', 'c807')
const ST0_DIR = path.join(RUN_ROOT, 'runs', 'st0')
const REAL_GAP_MS = 95000
const POLL_MS = 1000
const OWNERLESS_WAIT_MS = 10 * 60 * 1000
const SLOT_DIRS = { a: 'fullrun-slot', b: 'fullrun-slot-b' }
export const LIMIT_NOTE = 'A release by another lane tool that writes no last-release file and that this process did not observe is invisible; the 95 s gap is then not enforced for it.'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

//#region root and files
function resolveRoot() {
  const rootEnv = process.env.C807_SLOT_ROOT
  const gapEnv = process.env.C807_SLOT_GAP_MS
  if (rootEnv === undefined) {
    if (gapEnv !== undefined) throw new Error('C807_SLOT_GAP_MS is honoured only with C807_SLOT_ROOT under ' + RUN_ROOT)
    return { root: TEMP_ROOT, gapMs: REAL_GAP_MS }
  }
  const root = path.resolve(rootEnv)
  const rel = path.relative(RUN_ROOT, root)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('C807_SLOT_ROOT must lie under ' + RUN_ROOT + ': ' + root)
  let gapMs = REAL_GAP_MS
  if (gapEnv !== undefined) {
    gapMs = Number(gapEnv)
    if (!Number.isFinite(gapMs) || gapMs < 0) throw new Error('C807_SLOT_GAP_MS is not a number of milliseconds: ' + gapEnv)
  }
  return { root, gapMs }
}

const slotDir = (root, which) => path.join(root, SLOT_DIRS[which])
const lastFile = (root, which) => path.join(root, 'c807-lastrelease-' + which + '.json')

function readOwner(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'owner.txt'), 'utf8').trim()
  } catch {
    return null
  }
}

function readLastMs(file) {
  try {
    const ms = JSON.parse(fs.readFileSync(file, 'utf8')).ms
    return Number.isFinite(ms) ? ms : 0
  } catch {
    return 0
  }
}

function persistLastRelease(root, which, ms, token) {
  try {
    fs.writeFileSync(lastFile(root, which), JSON.stringify({ time: new Date(ms).toISOString(), ms, owner: token }) + '\n')
  } catch {}
}

function otherProvenance(root, which) {
  const other = which === 'a' ? 'b' : 'a'
  const dir = slotDir(root, other)
  if (!fs.existsSync(dir)) return { slot: other, state: 'free', owner: null }
  const owner = readOwner(dir)
  return { slot: other, state: owner === null ? 'ownerless' : 'held', owner }
}
//#endregion

//#region acquire and release
const live = new Set()
const stopHooks = []
let hooked = false

function releaseAll() {
  for (const h of [...live]) h.release()
}

function hookProcess() {
  if (hooked) return
  hooked = true
  process.on('exit', releaseAll)
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      for (const stop of stopHooks) {
        try { stop() } catch {}
      }
      releaseAll()
      process.exit(signal === 'SIGINT' ? 130 : 143)
    })
  }
}

function releaseHandle(h) {
  if (h.released) return h.result
  h.released = true
  live.delete(h)
  let removed = false
  try {
    const current = readOwner(h.dir)
    if (current === h.token) {
      fs.rmSync(h.dir, { recursive: true, force: true })
      removed = true
    }
  } catch {}
  const releasedAtMs = Date.now()
  if (removed) persistLastRelease(h.root, h.slot, releasedAtMs, h.token)
  h.result = { slot: h.slot, removed, releasedAtMs, ownerNow: removed ? null : readOwner(h.dir), otherAtRelease: otherProvenance(h.root, h.slot) }
  return h.result
}

export async function acquire({ which = 'any', text, maxWaitMs, pollMs = POLL_MS }) {
  if (!['a', 'b', 'any'].includes(which)) throw new Error('which must be a, b or any: ' + which)
  if (typeof text !== 'string' || text === '') throw new Error('acquire needs an owner text')
  const { root, gapMs } = resolveRoot()
  const candidates = which === 'any' ? ['a', 'b'] : [which]
  const t0 = Date.now()
  const sawHeld = { a: false, b: false }
  const observedGone = { a: 0, b: 0 }
  const ownerlessSince = { a: null, b: null }
  fs.mkdirSync(root, { recursive: true })
  hookProcess()
  for (;;) {
    let waitMs = pollMs
    for (const w of candidates) {
      const dir = slotDir(root, w)
      if (!fs.existsSync(dir)) {
        ownerlessSince[w] = null
        if (sawHeld[w] && observedGone[w] === 0) observedGone[w] = Date.now()
        const remaining = Math.max(readLastMs(lastFile(root, w)), observedGone[w]) + gapMs - Date.now()
        if (remaining > 0) {
          waitMs = Math.min(waitMs, remaining)
          continue
        }
        try {
          fs.mkdirSync(dir)
        } catch (e) {
          if (e.code !== 'EEXIST') throw e
          sawHeld[w] = true
          observedGone[w] = 0
          continue
        }
        const token = text + ' [pid ' + process.pid + ' nonce ' + randomBytes(6).toString('hex') + '] (since ' + new Date().toISOString().slice(0, 19) + ')'
        fs.writeFileSync(path.join(dir, 'owner.txt'), token + '\n')
        const h = { slot: w, root, dir, token, waitedMs: Date.now() - t0, acquiredAtMs: Date.now(), otherAtAcquire: otherProvenance(root, w), released: false, result: null, release: () => releaseHandle(h) }
        live.add(h)
        return h
      }
      sawHeld[w] = true
      observedGone[w] = 0
      if (readOwner(dir) === null) {
        ownerlessSince[w] ??= Date.now()
        continue
      }
      ownerlessSince[w] = null
    }
    if (candidates.every((w) => ownerlessSince[w] !== null)) {
      const oldest = Math.min(...candidates.map((w) => ownerlessSince[w]))
      if (Date.now() - oldest >= (maxWaitMs ?? OWNERLESS_WAIT_MS)) {
        const named = candidates.map((w) => slotDir(root, w) + ' (mtime ' + fs.statSync(slotDir(root, w)).mtime.toISOString() + ')').join(', ')
        throw new Error('ownerless slot, not taken and not removed: ' + named + '; it has no owner.txt. Stopping for the orchestrator to decide.')
      }
    }
    if (maxWaitMs !== undefined && Date.now() - t0 >= maxWaitMs) throw new Error('timed out after ' + maxWaitMs + ' ms waiting for slot ' + which)
    await sleep(waitMs)
  }
}
//#endregion

//#region checks (T0a-T0c)
const FOREIGN = 'foreign lane owner (not ours)'

function scratchRoot(name) {
  const base = path.join(ST0_DIR, 'scratch')
  fs.mkdirSync(base, { recursive: true })
  return fs.mkdtempSync(path.join(base, name + '-'))
}

async function withEnv(root, gapMs, fn) {
  const saved = { root: process.env.C807_SLOT_ROOT, gap: process.env.C807_SLOT_GAP_MS }
  process.env.C807_SLOT_ROOT = root
  if (gapMs === null) delete process.env.C807_SLOT_GAP_MS
  else process.env.C807_SLOT_GAP_MS = String(gapMs)
  try {
    return await fn()
  } finally {
    if (saved.root === undefined) delete process.env.C807_SLOT_ROOT
    else process.env.C807_SLOT_ROOT = saved.root
    if (saved.gap === undefined) delete process.env.C807_SLOT_GAP_MS
    else process.env.C807_SLOT_GAP_MS = saved.gap
  }
}

async function checkT0a() {
  const fails = []
  const root1 = scratchRoot('t0a-clean')
  await withEnv(root1, 300, async () => {
    const h = await acquire({ which: 'a', text: 't0a clean' })
    if (readOwner(h.dir) !== h.token) fails.push('owner.txt does not carry our token')
    const r = h.release()
    if (!r.removed || fs.existsSync(h.dir)) fails.push('release did not remove our own slot')
    if (readLastMs(lastFile(root1, 'a')) !== r.releasedAtMs) fails.push('the last-release file does not carry the release time')
    const hb = await acquire({ which: 'b', text: 't0a b' })
    if (hb.slot !== 'b' || readOwner(hb.dir) !== hb.token) fails.push('slot b was not acquired with our token')
    hb.release()
    if (fs.existsSync(hb.dir)) fails.push('slot b was not released')
  })
  const root2 = scratchRoot('t0a-foreign')
  await withEnv(root2, 300, async () => {
    const h = await acquire({ which: 'a', text: 't0a foreign' })
    fs.writeFileSync(path.join(h.dir, 'owner.txt'), FOREIGN + '\n')
    const r = h.release()
    if (r.removed) fails.push('release reported removing a foreign-owned slot')
    if (!fs.existsSync(h.dir) || readOwner(h.dir) !== FOREIGN) fails.push('a foreign-owned slot was removed or changed')
    if (fs.existsSync(lastFile(root2, 'a'))) fails.push('a last-release file was written for a slot we did not release')
    const hb = await acquire({ which: 'b', text: 't0a other' })
    if (hb.otherAtAcquire.owner !== FOREIGN || hb.otherAtAcquire.state !== 'held') fails.push('the other slot owner was not recorded at acquire')
    hb.release()
  })
  return fails
}

function childAcquire(env) {
  const r = spawnSync(process.execPath, [SELF, 'child-acquire', '--which', 'a', '--text', 't0b'], { env, encoding: 'utf8', windowsHide: true })
  try {
    return JSON.parse(r.stdout.trim().split('\n').pop())
  } catch {
    return { error: 'child output: ' + r.stdout + r.stderr }
  }
}

async function checkT0b() {
  const fails = []
  const root = scratchRoot('t0b')
  const gap = 4000
  const env = { ...process.env, C807_SLOT_ROOT: root, C807_SLOT_GAP_MS: String(gap) }
  const first = childAcquire(env)
  const second = childAcquire(env)
  if (first.error || second.error) return ['a child process failed: ' + (first.error ?? second.error)]
  if (second.acquiredAtMs - first.releasedAtMs < gap) fails.push('the second process took slot a ' + (second.acquiredAtMs - first.releasedAtMs) + ' ms after the first release, under the ' + gap + ' ms gap')
  if (!fs.existsSync(lastFile(root, 'a'))) fails.push('no last-release file was left by the first process')
  return fails
}

async function checkT0c() {
  const fails = []
  const root = scratchRoot('t0c')
  const dirA = slotDir(root, 'a')
  fs.mkdirSync(dirA)
  const mtime = fs.statSync(dirA).mtimeMs
  await withEnv(root, 300, async () => {
    let took = null
    try {
      took = await acquire({ which: 'a', text: 't0c a', maxWaitMs: 2500 })
    } catch (e) {
      if (!/ownerless/.test(e.message)) fails.push('the stop message does not say ownerless: ' + e.message)
    }
    if (took !== null) {
      fails.push('an ownerless slot a was taken')
      took.release()
    }
    if (!fs.existsSync(dirA) || fs.statSync(dirA).mtimeMs !== mtime || fs.readdirSync(dirA).length !== 0) fails.push('the ownerless slot a directory was removed or changed')
    const hb = await acquire({ which: 'any', text: 't0c any', maxWaitMs: 5000 })
    if (hb.slot !== 'b') fails.push('which any did not take slot b past an ownerless slot a')
    hb.release()
    if (!fs.existsSync(dirA)) fails.push('slot a directory vanished during which any')
  })
  return fails
}

async function checkOverrideRefused() {
  const fails = []
  const refused = async (rootEnv, gapEnv) => {
    const saved = { root: process.env.C807_SLOT_ROOT, gap: process.env.C807_SLOT_GAP_MS }
    if (rootEnv === undefined) delete process.env.C807_SLOT_ROOT
    else process.env.C807_SLOT_ROOT = rootEnv
    if (gapEnv === undefined) delete process.env.C807_SLOT_GAP_MS
    else process.env.C807_SLOT_GAP_MS = gapEnv
    try {
      resolveRoot()
      return false
    } catch {
      return true
    } finally {
      if (saved.root === undefined) delete process.env.C807_SLOT_ROOT
      else process.env.C807_SLOT_ROOT = saved.root
      if (saved.gap === undefined) delete process.env.C807_SLOT_GAP_MS
      else process.env.C807_SLOT_GAP_MS = saved.gap
    }
  }
  if (!(await refused(TEMP_ROOT, '1000'))) fails.push('the real root accepted an override')
  if (!(await refused(path.join(TEMP_ROOT, 'elsewhere'), undefined))) fails.push('a root outside the c807 run root was accepted')
  if (!(await refused(undefined, '1000'))) fails.push('a gap override without a root was accepted')
  if (await refused(path.join(RUN_ROOT, 'runs', 'x'), '1000')) fails.push('a root under the c807 run root was refused')
  return fails
}

const CHECKS = [
  ['T0a', checkT0a],
  ['T0b', checkT0b],
  ['T0c', checkT0c],
  ['override-refused', checkOverrideRefused],
]

async function runChecks() {
  let bad = 0
  for (const [name, fn] of CHECKS) {
    let fails
    try {
      fails = await fn()
    } catch (e) {
      fails = ['threw: ' + (e.stack ?? e.message)]
    }
    if (fails.length === 0) console.log('PASS ' + name)
    else {
      bad++
      console.log('FAIL ' + name + ': ' + fails.join('; '))
    }
  }
  return bad
}
//#endregion

//#region mutants
// Each mutant replaces exactly one line of a scratch copy; the check it must turn red is named.
const MUTANTS = [
  { name: 'steal-slot', from: '    if (current === h.token) {', to: '    if (fs.existsSync(h.dir)) {', red: 'T0a' },
  { name: 'gap-in-memory', from: 'function persistLastRelease(root, which, ms, token) {', to: 'function persistLastRelease(root, which, ms, token) { return', red: 'T0b' },
  { name: 'steal-ownerless', from: '        ownerlessSince[w] ??= Date.now()', to: '        fs.rmSync(dir, { recursive: true, force: true })', red: 'T0c' },
]

function runChild(file, logFile) {
  const r = spawnSync(process.execPath, [file, 'checks'], { encoding: 'utf8', windowsHide: true, timeout: 5 * 60 * 1000 })
  const out = (r.stdout ?? '') + (r.stderr ?? '')
  fs.writeFileSync(logFile, out)
  return { status: r.status, out }
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function selfcheck() {
  fs.mkdirSync(ST0_DIR, { recursive: true })
  const before = sha256(SELF)
  const problems = []
  const clean = runChild(SELF, path.join(ST0_DIR, 'selfcheck-clean.log'))
  console.log('clean: exit ' + clean.status + ', log ' + path.join(ST0_DIR, 'selfcheck-clean.log'))
  if (clean.status !== 0) problems.push('the clean checks are not all green')
  const source = fs.readFileSync(SELF, 'utf8').replace(/\r\n/g, '\n')
  const codeEnd = source.indexOf('//#region mutants')
  for (const m of MUTANTS) {
    const count = source.slice(0, codeEnd).split(m.from).length - 1
    if (count !== 1) {
      problems.push('mutant ' + m.name + ': snippet found ' + count + ' times, expected 1')
      continue
    }
    const dir = path.join(ST0_DIR, 'mut', m.name)
    fs.mkdirSync(dir, { recursive: true })
    const copy = path.join(dir, 'c807-slot.mjs')
    fs.writeFileSync(copy, source.replace(m.from, () => m.to))
    const log = path.join(ST0_DIR, 'selfcheck-mut-' + m.name + '.log')
    const r = runChild(copy, log)
    const red = r.status !== 0 && r.out.includes('FAIL ' + m.red)
    console.log('mutant ' + m.name + ': exit ' + r.status + ', ' + (red ? 'red as expected (' + m.red + ')' : 'NOT red on ' + m.red) + ', log ' + log)
    if (!red) problems.push('mutant ' + m.name + ' did not turn ' + m.red + ' red')
  }
  const after = sha256(SELF)
  console.log('repo file sha256 before ' + before + ', after ' + after)
  if (before !== after) problems.push('the repository file changed during the self-check')
  console.log(problems.length === 0 ? 'SELFCHECK OK' : 'SELFCHECK FAILED: ' + problems.join('; '))
  return problems.length === 0 ? 0 : 1
}
//#endregion

//#region command line
function flagsOf(argv) {
  const o = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error('unexpected argument: ' + argv[i])
    o[argv[i].slice(2)] = argv[++i]
  }
  return o
}

function killTree(pid) {
  if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
  else process.kill(pid)
}

async function runCommand(argv) {
  const split = argv.indexOf('--')
  if (split < 0 || split === argv.length - 1) throw new Error('run needs: -- <command> [args...]')
  const o = flagsOf(argv.slice(0, split))
  const cmd = argv.slice(split + 1)
  const maxWaitMs = o['max-wait-min'] === undefined ? undefined : Number(o['max-wait-min']) * 60000
  const slot = await acquire({ which: o.which ?? 'any', text: o.text, maxWaitMs })
  console.log('slot ' + slot.slot + ' acquired after ' + slot.waitedMs + ' ms; other slot ' + JSON.stringify(slot.otherAtAcquire))
  const startedAt = new Date().toISOString()
  let child = null
  stopHooks.push(() => {
    if (child !== null && child.pid) killTree(child.pid)
  })
  const code = await new Promise((resolve) => {
    child = spawn(cmd[0], cmd.slice(1), { stdio: 'inherit', windowsHide: true })
    child.on('error', (e) => {
      console.error('could not start ' + cmd[0] + ': ' + e.message)
      resolve(127)
    })
    child.on('exit', (c) => resolve(c ?? 1))
  })
  const released = slot.release()
  const record = {
    command: cmd, exitCode: code, slot: slot.slot, token: slot.token, waitedMs: slot.waitedMs, startedAt, endedAt: new Date().toISOString(),
    otherAtAcquire: slot.otherAtAcquire, otherAtRelease: released.otherAtRelease, released: released.removed, limit: LIMIT_NOTE,
  }
  if (o.record) fs.writeFileSync(o.record, JSON.stringify(record, null, 2) + '\n')
  console.log('slot ' + slot.slot + ' released: ' + released.removed + '; command exit ' + code)
  return code
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (command === 'run') return runCommand(rest)
  if (command === 'checks') return (await runChecks()) === 0 ? 0 : 1
  if (command === 'selfcheck') return selfcheck()
  if (command === 'child-acquire') {
    const o = flagsOf(rest)
    const h = await acquire({ which: o.which, text: o.text })
    const r = h.release()
    console.log(JSON.stringify({ acquiredAtMs: h.acquiredAtMs, releasedAtMs: r.releasedAtMs, waitedMs: h.waitedMs }))
    return 0
  }
  console.error('usage: c807-slot.mjs run|selfcheck|checks (see the header)')
  return 2
}

if (process.argv[1] && path.resolve(process.argv[1]) === SELF) {
  main().then((code) => process.exit(code), (e) => {
    console.error(e.message)
    process.exit(1)
  })
}
//#endregion

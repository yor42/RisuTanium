// Device kit library: the adb serial and the CDP port have no default, names that become paths are checked, and sharp is
// found through the checkout. Importing it neither connects nor writes anything.
// Invariants:
// - devicePort() and requireSerial() throw when the environment does not name the port or the serial, so a run never
//   drives a phone or a browser it was not pointed at.
// - safeName() admits only a plain file name, so a build or trial name cannot leave the out dir.
// - Every adb call this kit makes is built by guardedAdb(): node running the guard beside this tool tree, with --kit first. The
//   guard refuses a --kit call on any serial other than the two spare Note 9s before it sends anything. No environment variable
//   or argument selects the guard or an adb executable.
// Env: HARNESS_CDP (forwarded CDP port), HARNESS_SERIAL (adb serial), HARNESS_GUARD_LOG (absolute guard log path), HARNESS_OUT (out dir).
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'
import { REPO_ROOT, connect, outDir, sleep } from '../lib.mjs'

export { connect, outDir, sleep }

export function devicePort() {
  const v = process.env.HARNESS_CDP
  if (!v || !/^\d+$/.test(v)) throw new Error('HARNESS_CDP must name the forwarded CDP port; there is no default')
  const n = Number(v)
  if (n < 1024 || n > 65535) throw new Error('HARNESS_CDP out of range: ' + v)
  return n
}

export function requireSerial() {
  const v = process.env.HARNESS_SERIAL
  if (!v || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/.test(v)) throw new Error('HARNESS_SERIAL must name the adb serial; there is no default')
  return v
}

const ADBG = fileURLToPath(new URL('../../device-guard/adbg.mjs', import.meta.url))

export function guardLog() {
  const v = process.env.HARNESS_GUARD_LOG
  if (!v || !path.isAbsolute(v)) throw new Error('HARNESS_GUARD_LOG must name the absolute guard log path; there is no default')
  return v
}

// The one place that builds a guard argument list for adb: --kit first, then the serial and the log, then the adb arguments.
export function guardedAdb(args) {
  return { file: process.execPath, args: [ADBG, '--kit', '--serial', requireSerial(), '--log', guardLog(), '--', ...args] }
}

// Runs one guarded adb call. Resolves to { code, adbgLine }: the exit code (null when the call outlived timeoutMs and was killed) and
// the first stderr line that starts with "adbg: " (the guard's own refusal or error text), or '' when there is none.
export function runGuardedAdb(args, timeoutMs) {
  const { file, args: argv } = guardedAdb(args)
  return new Promise((resolve) => {
    const child = spawn(file, argv, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    child.stderr.on('data', (d) => { err += d })
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, timeoutMs)
    const done = (code) => {
      clearTimeout(timer)
      const adbgLine = err.split(/\r?\n/).find((l) => l.startsWith('adbg: ')) || ''
      resolve({ code: timedOut ? null : code, adbgLine })
    }
    child.on('error', () => done(1))
    child.on('close', (code) => done(code))
  })
}

export function safeName(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(s)) throw new Error('bad name (letters, digits, _ and - only, 1-40): ' + JSON.stringify(s))
  return s
}

export const deviceConnect = () => connect({ port: devicePort() })

// sharp is a transitive dependency, so it is not at the top of node_modules; try that first, then each copy in the pnpm store.
export function loadSharp() {
  const require = createRequire(path.join(REPO_ROOT, 'package.json'))
  const tried = []
  try { return require('sharp') } catch (e) { tried.push(String(e.message || e).split('\n')[0]) }
  const store = path.join(REPO_ROOT, 'node_modules', '.pnpm')
  const names = fs.existsSync(store) ? fs.readdirSync(store).filter((n) => n.startsWith('sharp@')).sort().reverse() : []
  for (const n of names) {
    try { return require(path.join(store, n, 'node_modules', 'sharp')) } catch (e) { tried.push(n + ': ' + String(e.message || e).split('\n')[0]) }
  }
  throw new Error('sharp not found under ' + REPO_ROOT + ' :: ' + tried.join(' | '))
}

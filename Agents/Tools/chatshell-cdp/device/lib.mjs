// Device kit library: the adb serial and the CDP port have no default, names that become paths are checked, and sharp is
// found through the checkout. Importing it neither connects nor writes anything.
// Invariants:
// - devicePort() and requireSerial() throw when the environment does not name the port or the serial, so a run never
//   drives a phone or a browser it was not pointed at.
// - safeName() admits only a plain file name, so a build or trial name cannot leave the out dir.
// Env: HARNESS_CDP (forwarded CDP port), HARNESS_SERIAL (adb serial), HARNESS_ADB (adb executable), HARNESS_OUT (out dir).
import { createRequire } from 'node:module'
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

export const adbExe = () => process.env.HARNESS_ADB || 'adb'

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

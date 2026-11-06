// node launch-chrome.mjs [--port 9470] [--profile <dir>] [--out <dir>]
// Starts a headful Chrome for the harness with the host-blocking flags from lib.mjs (argument array, no shell).
// Exit codes: 0 started and confirmed, 2 bad argument or a path inside the checkout, 3 the port is already in use,
// 4 no Chrome found (CHROME_PATH set but missing never falls back), 5 the spawned child was not confirmed.
// Invariants:
// - Nothing is killed except the child this script spawned, and only when it was not confirmed.
// - <out>/chrome.pid is written only after the spawned child is alive and its own /json/version answers. Chrome hands an
//   in-use profile to the running instance and exits, so a dead child means the answering port is not ours.
// - Teardown is the caller's: stop only the PID in chrome.pid, after checking that the process name is chrome.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { cdpPort, chromeArgs, outDir } from './lib.mjs'

const argv = process.argv.slice(2)
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const fail = (code, msg) => { console.error('launch-chrome: ' + msg); process.exit(code) }

let port, args, out
try {
  port = arg('--port') === null ? cdpPort() : Number(arg('--port'))
  args = [...chromeArgs({ port, profile: arg('--profile') || undefined }), 'about:blank']
  out = outDir(arg('--out'))
} catch (e) { fail(2, String(e.message || e)) }

const versionUrl = `http://127.0.0.1:${port}/json/version`
async function version(timeoutMs) {
  try {
    const r = await fetch(versionUrl, { signal: AbortSignal.timeout(timeoutMs) })
    return r.ok ? await r.json() : null
  } catch { return null }
}
const listenable = () => new Promise((resolve) => {
  const s = net.createServer()
  s.once('error', () => resolve(false))
  s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
})

if ((await version(1000)) !== null || !(await listenable())) fail(3, 'port in use: ' + port)

function chromePath() {
  if (process.env.CHROME_PATH) return fs.existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean)
  for (const root of roots) {
    const p = path.join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')
    if (fs.existsSync(p)) return p
  }
  return null
}
const exe = chromePath()
if (!exe) fail(4, process.env.CHROME_PATH ? 'CHROME_PATH does not exist: ' + process.env.CHROME_PATH : 'no Chrome found; set CHROME_PATH')

const child = spawn(exe, args, { detached: true, stdio: 'ignore' })
let dead = false
child.on('error', () => { dead = true })
child.on('exit', () => { dead = true })

let confirmed = false
for (let waited = 0; waited < 15000 && !dead; waited += 250) {
  const v = await version(500)
  if (v !== null && /Chrome/.test(String(v.Browser))) { confirmed = true; break }
  await new Promise(r => setTimeout(r, 250))
}
if (!confirmed || dead) {
  if (!dead) child.kill()
  fail(5, 'the spawned browser was not confirmed on port ' + port + (dead ? ' (it exited)' : ' (no answer in 15 s)'))
}

fs.writeFileSync(path.join(out, 'chrome.pid'), String(child.pid) + '\n')
console.log('args: ' + JSON.stringify(args))
console.log('pid ' + child.pid + ' port ' + port + ' pidfile ' + path.join(out, 'chrome.pid'))
child.unref()
process.exit(0)

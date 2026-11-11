// node launch-chrome.mjs [--port 9470] [--profile <dir>] [--out <dir>] [--proxy-port <n>]
// Starts a loopback-only HTTP proxy, then a headful Chrome for the harness behind it, with the host-blocking flags from lib.mjs
// (argument array, no shell). The launcher stays up while Chrome runs and exits 0 when Chrome exits: run it as a background job.
// Exit codes: 0 Chrome ran and has since exited, 2 bad argument or a path inside the checkout, 3 the port is already in use,
// 4 no Chrome found (CHROME_PATH set but missing never falls back), 5 the spawned child was not confirmed,
// 6 the proxy did not start or does not accept connections (Chrome is never spawned), 7 the read-back arguments lack the proxy or
// the host-resolver flag (the spawned child is killed).
// Invariants:
// - Fail closed: Chrome is spawned only after the proxy accepts a TCP connect, and it only ever runs with --proxy-server and
//   --host-resolver-rules. The proxy dies with this process, so Chrome then has no network at all.
// - The proxy forwards only to localhost, 127.0.0.1, [::1] and the alias mock.test (dialled as 127.0.0.1, as the resolver rule in
//   lib.mjs maps it); every other target (plain request or CONNECT) is refused with 403 and logged as one JSON line
//   {time, method, target} to <out>/proxy-refusals.jsonl and stderr.
// - Nothing is killed except the child this script spawned, when it was not confirmed or its read-back arguments are wrong.
// - <out>/chrome.pid, proxy.port and launcher.pid are written only after the spawned child is alive, its own /json/version
//   answers and the read-back passed. Chrome hands an in-use profile to the running instance and exits, so a dead child means
//   the answering port is not ours.
// - Teardown is the caller's: stop only the PID in chrome.pid, after checking that the process name is chrome; the launcher then exits.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { cdpPort, chromeArgs, outDir, wsPath } from './lib.mjs'

const argv = process.argv.slice(2)
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
const fail = (code, msg) => { console.error('launch-chrome: ' + msg); process.exit(code) }

let port, baseArgs, out, proxyPortReq
try {
  port = arg('--port') === null ? cdpPort() : Number(arg('--port'))
  baseArgs = chromeArgs({ port, profile: arg('--profile') || undefined })
  out = outDir(arg('--out'))
  proxyPortReq = arg('--proxy-port') === null ? 0 : Number(arg('--proxy-port'))
  if (!Number.isInteger(proxyPortReq) || proxyPortReq < 0 || (proxyPortReq !== 0 && proxyPortReq < 1024) || proxyPortReq > 65535) throw new Error('bad proxy port: ' + arg('--proxy-port'))
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

// Loopback-only proxy. localhost and mock.test are dialled as 127.0.0.1 so the target never depends on name resolution.
const refusalsFile = path.join(out, 'proxy-refusals.jsonl')
function refuse(method, target) {
  const line = JSON.stringify({ time: new Date().toISOString(), method, target })
  try { fs.appendFileSync(refusalsFile, line + '\n') } catch {}
  console.error(line)
}
function loopbackHost(hostname) {
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === 'mock.test') return '127.0.0.1'
  if (hostname === '[::1]') return '::1'
  return null
}
function plainTarget(raw) {
  try {
    const u = new URL(raw)
    const host = u.protocol === 'http:' ? loopbackHost(u.hostname) : null
    return host === null ? null : { host, port: Number(u.port || 80), path: u.pathname + u.search }
  } catch { return null }
}
function connectTarget(raw) {
  const m = /^(\[[^\]]+\]|[^:\[\]]+):(\d{1,5})$/.exec(String(raw))
  const host = m === null ? null : loopbackHost(m[1].toLowerCase())
  return host === null || Number(m[2]) < 1 || Number(m[2]) > 65535 ? null : { host, port: Number(m[2]) }
}
const proxy = http.createServer((req, res) => {
  const t = plainTarget(req.url)
  if (t === null) {
    refuse(req.method, req.url)
    res.writeHead(403, { 'content-type': 'text/plain' })
    res.end('refused by the harness proxy\n')
    return
  }
  const headers = { ...req.headers }
  delete headers['proxy-connection']
  const up = http.request({ host: t.host, port: t.port, method: req.method, path: t.path, headers }, (ur) => {
    res.writeHead(ur.statusCode, ur.headers)
    ur.pipe(res)
  })
  up.on('error', () => { if (res.headersSent) res.destroy(); else { res.writeHead(502); res.end() } })
  req.pipe(up)
})
proxy.on('connect', (req, socket, head) => {
  socket.on('error', () => socket.destroy())
  const t = connectTarget(req.url)
  if (t === null) {
    refuse('CONNECT', req.url)
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n', () => socket.destroy())
    return
  }
  const up = net.connect(t.port, t.host, () => {
    socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
    if (head.length) up.write(head)
    up.pipe(socket)
    socket.pipe(up)
  })
  up.on('error', () => socket.destroy())
  socket.on('close', () => up.destroy())
})
proxy.on('clientError', (e, socket) => { refuse('CLIENT_ERROR', e.code ?? String(e.message)); socket.destroy() })

const listenError = await new Promise((resolve) => {
  proxy.once('error', resolve)
  proxy.listen(proxyPortReq, '127.0.0.1', () => resolve(null))
})
if (listenError !== null) fail(6, 'proxy did not start: ' + listenError.message)
const proxyPort = proxy.address().port
const reachable = await new Promise((resolve) => {
  const s = net.connect(proxyPort, '127.0.0.1', () => { s.destroy(); resolve(true) })
  s.once('error', () => resolve(false))
})
if (!reachable) fail(6, 'proxy does not accept connections on port ' + proxyPort)

const args = [...baseArgs, `--proxy-server=http://127.0.0.1:${proxyPort}`, '--proxy-bypass-list=<-loopback>', 'about:blank']
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

// Effective arguments of the running browser: CDP Browser.getBrowserCommandLine (Chrome answers it only with --enable-automation),
// else the spawned PID's command line through a CIM query (Windows).
async function effectiveArguments() {
  let ws = null
  try {
    const v = await version(2000)
    const { default: WebSocket } = await import(pathToFileURL(wsPath).href)
    ws = new WebSocket(v.webSocketDebuggerUrl, { perMessageDeflate: false })
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), 5000)
      ws.on('error', (e) => { clearTimeout(timer); reject(e) })
      ws.on('open', () => ws.send(JSON.stringify({ id: 1, method: 'Browser.getBrowserCommandLine' })))
      ws.on('message', (d) => {
        const m = JSON.parse(d)
        if (m.id !== 1) return
        clearTimeout(timer)
        if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result)
      })
    })
    if (Array.isArray(result.arguments) && result.arguments.length > 0) return { source: 'cdp Browser.getBrowserCommandLine', arguments: result.arguments }
  } catch {} finally { try { ws && ws.close() } catch {} }
  try {
    const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId=${Number(child.pid)}').CommandLine`], { encoding: 'utf8', timeout: 15000 }).trim()
    if (text) return { source: 'cim Win32_Process CommandLine of pid ' + child.pid, arguments: [text] }
  } catch {}
  return { source: 'none', arguments: [] }
}
const effective = await effectiveArguments()
const joined = effective.arguments.join(' ')
const proxyOk = joined.includes('--proxy-server=http://127.0.0.1:' + proxyPort)
const resolverOk = joined.includes('--host-resolver-rules=')
fs.writeFileSync(path.join(out, 'launch-readback.json'), JSON.stringify({ time: new Date().toISOString(), pid: child.pid, source: effective.source, proxyServerPresent: proxyOk, hostResolverRulesPresent: resolverOk, arguments: effective.arguments }, null, 2) + '\n')
if (!proxyOk || !resolverOk) {
  if (!dead) child.kill()
  fail(7, 'the read-back arguments lack ' + [proxyOk ? null : '--proxy-server', resolverOk ? null : '--host-resolver-rules'].filter(Boolean).join(' and ') + ' (source: ' + effective.source + ')')
}

fs.writeFileSync(path.join(out, 'chrome.pid'), String(child.pid) + '\n')
fs.writeFileSync(path.join(out, 'proxy.port'), String(proxyPort) + '\n')
fs.writeFileSync(path.join(out, 'launcher.pid'), String(process.pid) + '\n')
console.log('args: ' + JSON.stringify(args))
console.log('pid ' + child.pid + ' port ' + port + ' proxy ' + proxyPort + ' launcher ' + process.pid + ' pidfile ' + path.join(out, 'chrome.pid'))
child.on('exit', () => process.exit(0))
if (dead) process.exit(0)

// node Agents/Tools/device/tests/cdp-session.accept.mjs
// Acceptance test of cdp-session.mjs on the PC, no device: a fake CDP server (node:http plus the repository's ws package),
// and, when a Chrome is installed, a headless Chrome on a free port that this script starts and stops by its own PID.
// Env: CDP_SESSION_PATH (another copy of the tool, for mutant runs), CDP_ACCEPT_SCRATCH (scratch folder; default: a new
// folder under the OS temp dir), CHROME_PATH (browser executable; default: the usual install paths).
// Plain asserts print PASS/FAIL/SKIP; exit 0 only if every assert holds.
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..')
const TOOL = process.env.CDP_SESSION_PATH ?? path.join(HERE, '..', 'cdp-session.mjs')
const { WebSocketServer } = createRequire(path.join(REPO_ROOT, 'package.json'))('ws')
const SCRATCH = process.env.CDP_ACCEPT_SCRATCH ?? mkdtempSync(path.join(os.tmpdir(), 'cdp-session-accept-'))
mkdirSync(SCRATCH, { recursive: true })

const ALLOWED = ['Runtime.enable', 'Runtime.disable', 'Runtime.evaluate', 'Profiler.enable', 'Profiler.disable',
  'Profiler.setSamplingInterval', 'Profiler.start', 'Profiler.stop']
const FORBIDDEN_TEXT = ['Target.createTarget', 'Page.navigate', 'Page.reload', 'Input.', 'Storage.', 'Network.']

let failures = 0
const check = (ok, name, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : (detail ? ' :: ' + detail : '')))
  if (!ok) failures++
}

if (!existsSync(TOOL)) {
  console.log('FAIL the tool does not exist: ' + TOOL)
  process.exit(1)
}

function runTool(args, extra = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, ...args], { stdio: ['ignore', 'pipe', 'pipe'], ...extra })
    let stdout = ''
    let stderr = ''
    const started = Date.now()
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - started }))
  })
}

// ---- fake CDP server -------------------------------------------------------------------------------------------------
function startFake({ pageCount = 1, mute = false } = {}) {
  const methods = []
  const server = http.createServer((request, response) => {
    if (request.url === '/json') {
      const address = server.address()
      const targets = []
      for (let i = 0; i < pageCount; i++) {
        targets.push({ type: 'page', url: 'http://fake/page' + i, webSocketDebuggerUrl: 'ws://127.0.0.1:' + address.port + '/devtools/page/' + i })
      }
      targets.push({ type: 'page', url: 'devtools://devtools/bundled/inspector.html', webSocketDebuggerUrl: 'ws://127.0.0.1:' + address.port + '/devtools/page/dt' })
      targets.push({ type: 'service_worker', url: 'http://fake/sw.js', webSocketDebuggerUrl: 'ws://127.0.0.1:' + address.port + '/devtools/page/sw' })
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify(targets))
    } else {
      response.statusCode = 404
      response.end()
    }
  })
  const wss = new WebSocketServer({ server })
  wss.on('connection', (socket) => {
    if (mute) return
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      methods.push(message.method)
      const reply = (result) => socket.send(JSON.stringify({ id: message.id, result }))
      const expression = message.params?.expression ?? ''
      if (message.method === 'Runtime.enable') {
        reply({})
        setTimeout(() => {
          const emit = (text, context) => socket.send(JSON.stringify({ method: 'Runtime.consoleAPICalled',
            params: { type: 'log', args: [{ type: 'string', value: text }, { type: 'number', value: 7.5 }], executionContextId: context, timestamp: 1700000000500 } }))
          emit('c17-ready', 3)
          emit('noise', 4)
        }, 100)
      } else if (message.method === 'Runtime.evaluate') {
        if (expression === '1+1') reply({ result: { type: 'number', value: 2 } })
        else if (expression.includes('pagePerfMs')) reply({ result: { type: 'object', value: { pagePerfMs: 1000, pageDateMs: 1700000000000 } } })
        else if (expression.includes('.stop()')) reply({ result: { type: 'string', value: JSON.stringify({ ok: true, counts: [1, 2] }) } })
        else reply({ result: { type: 'undefined' } })
      } else if (message.method === 'Profiler.stop') {
        reply({ profile: {
          nodes: [
            { id: 1, callFrame: { functionName: '(root)', url: '', lineNumber: -1 } },
            { id: 2, callFrame: { functionName: 'hotLoop', url: 'http://fake/a.js', lineNumber: 9 } },
            { id: 3, callFrame: { functionName: '(idle)', url: '', lineNumber: -1 } },
          ],
          startTime: 0, endTime: 5000, samples: [2, 2, 2, 3, 2], timeDeltas: [0, 1000, 1000, 1000, 1000],
        } })
      } else reply({})
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    port: server.address().port, methods,
    close: () => { for (const c of wss.clients) c.terminate(); server.close() },
  })))
}

// ---- checks against the fake ----------------------------------------------------------------------------------------
{
  const fake = await startFake()
  const port = String(fake.port)

  const evalRun = await runTool([port, 'eval', '-e', '1+1'])
  check(evalRun.code === 0 && evalRun.stdout.trim() === '2', '1 eval returns the value and exits 0', evalRun.code + ' ' + evalRun.stdout + evalRun.stderr)

  const profilePath = path.join(SCRATCH, 'fake', 'p.cpuprofile')
  const profileRun = await runTool([port, 'profile', '--seconds', '2', '--out', profilePath])
  check(profileRun.code === 0, '2a profile exits 0', profileRun.stderr)
  const profile = JSON.parse(readFileSync(profilePath, 'utf8'))
  check(Array.isArray(profile.nodes) && Array.isArray(profile.samples) && Array.isArray(profile.timeDeltas), '2b profile has nodes, samples, timeDeltas')
  const top = JSON.parse(readFileSync(profilePath + '.top.json', 'utf8')).top
  const sorted = top.every((entry, i) => i === 0 || top[i - 1].selfMs >= entry.selfMs)
  check(top.length > 0 && sorted && top[0].name === 'hotLoop' && top[0].selfMs === 3 && top[0].line === 10, '2c top.json sorted descending, hotLoop first with 3 ms', JSON.stringify(top))
  const groups = JSON.parse(readFileSync(profilePath + '.groups.json', 'utf8')).groups
  check(groups[0].url === 'http://fake/a.js' && groups[0].selfMs === 3, '2d groups.json groups self time by url', JSON.stringify(groups))

  const probePath = path.join(SCRATCH, 'fake', 'probe-input.js')
  writeFileSync(probePath, 'window.__devb32Probe = { start() {}, stop() { return { ok: true } } }\n')
  const probeOut = path.join(SCRATCH, 'fake', 'probe.json')
  const probeRun = await runTool([port, 'probe', '--probe', probePath, '--seconds', '1', '--out', probeOut, '--console-filter', '^c17-'])
  check(probeRun.code === 0, '3a probe exits 0', probeRun.stderr)
  const probeJson = JSON.parse(readFileSync(probeOut, 'utf8'))
  check(probeJson.events.length === 1 && probeJson.events[0].text === 'c17-ready 7.5' && typeof probeJson.events[0].timestamp === 'number'
    && probeJson.events[0].executionContextId === 3 && probeJson.events[0].pageMs === 1500, '3b filtered console event with numeric timestamp, context id and page-clock time', JSON.stringify(probeJson.events))
  check(probeJson.probe && probeJson.probe.ok === true && probeJson.probe.counts.length === 2, '3c probe JSON is written with the events')

  const allowed = new Set(ALLOWED)
  const outside = fake.methods.filter((m) => !allowed.has(m))
  check(fake.methods.length > 0 && outside.length === 0, '5b every method the server received is in the allowed list', JSON.stringify(outside))
  fake.close()
}

// probe --no-runtime: no Runtime.enable (or any other Runtime.* control call) and no console events; without the flag exactly one Runtime.enable
{
  const probeInput = path.join(SCRATCH, 'fake', 'probe-input.js')
  const withRuntime = await startFake()
  const withRun = await runTool([String(withRuntime.port), 'probe', '--probe', probeInput, '--seconds', '1', '--out', path.join(SCRATCH, 'fake', 'probe-rt.json')])
  check(withRun.code === 0 && withRuntime.methods.filter((m) => m === 'Runtime.enable').length === 1, '6a probe without the flag sends exactly one Runtime.enable', withRun.stderr + JSON.stringify(withRuntime.methods))
  withRuntime.close()

  const noRuntime = await startFake()
  const noOut = path.join(SCRATCH, 'fake', 'probe-nort.json')
  const noRun = await runTool([String(noRuntime.port), 'probe', '--no-runtime', '--probe', probeInput, '--seconds', '1', '--out', noOut, '--console-filter', '^c17-'])
  check(noRun.code === 0, '6b probe --no-runtime exits 0 (the flag takes no value and does not swallow the next option)', noRun.stderr)
  check(!noRuntime.methods.includes('Runtime.enable') && !noRuntime.methods.includes('Runtime.disable'), '6c probe --no-runtime sends neither Runtime.enable nor Runtime.disable', JSON.stringify(noRuntime.methods))
  check(noRuntime.methods.includes('Runtime.evaluate'), '6d probe --no-runtime still injects and stops the probe through Runtime.evaluate', JSON.stringify(noRuntime.methods))
  const noJson = JSON.parse(readFileSync(noOut, 'utf8'))
  check(Array.isArray(noJson.events) && noJson.events.length === 0 && noJson.probe && noJson.probe.ok === true, '6e probe --no-runtime writes events [] and the probe JSON', JSON.stringify(noJson).slice(0, 200))
  noRuntime.close()
}

{
  const fake = await startFake({ pageCount: 0 })
  const run = await runTool([String(fake.port), 'eval', '-e', '1+1'])
  check(run.code === 2, '4a zero page targets exit 2', String(run.code))
  fake.close()
}
{
  const fake = await startFake({ pageCount: 2 })
  const run = await runTool([String(fake.port), 'eval', '-e', '1+1'])
  check(run.code === 2 && run.stderr.includes('http://fake/page0') && run.stderr.includes('http://fake/page1'), '4b two page targets exit 2 and both are listed', run.code + ' ' + run.stderr)
  fake.close()
}
{
  const fake = await startFake({ mute: true })
  const run = await runTool([String(fake.port), 'eval', '--timeout', '1500', '-e', '1+1'])
  check(run.code === 3 && run.ms < 5000, '4c a server that never answers ends at the timeout with exit 3', run.code + ' ' + run.ms + ' ms')
  fake.close()
}

// the guard on the file itself: a compatibility guard, not a behaviour proof (5b is the behaviour proof)
{
  const source = readFileSync(TOOL, 'utf8')
  const hits = FORBIDDEN_TEXT.filter((text) => source.includes(text))
  check(hits.length === 0, '5a the tool source names no forbidden method', JSON.stringify(hits))
}

// ---- headless Chrome (optional) -------------------------------------------------------------------------------------
function findChrome() {
  const candidates = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
  return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null
}
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })

const chromePath = findChrome()
if (chromePath === null) {
  console.log('SKIP headless Chrome not found; set CHROME_PATH')
} else {
  const pagePath = path.join(SCRATCH, 'hot.html')
  writeFileSync(pagePath, '<!doctype html><title>hot</title><script>'
    + 'function hotLoop(){let x=0;for(let i=0;i<16000000;i++){x+=i%7}return x}'
    + 'setInterval(hotLoop,20)</script>\n')
  const chromePort = await freePort()
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-address=127.0.0.1',
    '--remote-debugging-port=' + chromePort, '--user-data-dir=' + path.join(SCRATCH, 'chrome-profile'), pathToFileURL(pagePath).href],
  { stdio: 'ignore' })
  try {
    let up = false
    for (let i = 0; i < 60 && !up; i++) {
      try { up = (await fetch('http://127.0.0.1:' + chromePort + '/json')).ok } catch { await new Promise((r) => setTimeout(r, 500)) }
    }
    check(up, 'chrome started on a free port')
    if (up) {
      await new Promise((r) => setTimeout(r, 1000))
      const out = path.join(SCRATCH, 'chrome', 'p.cpuprofile')
      const run = await runTool([String(chromePort), 'profile', '--seconds', '2', '--out', out])
      check(run.code === 0, '2e chrome profile exits 0', run.stderr)
      const profileTop = JSON.parse(readFileSync(out + '.top.json', 'utf8')).top
      // the profiler's pseudo-nodes ((idle), (program), (garbage collector), (root)) can outrank a real function by sampling luck
      const topFunction = profileTop.find((entry) => !entry.name.startsWith('('))
      check(topFunction?.name === 'hotLoop', '2f the busy function is the top self-time real function in headless Chrome', JSON.stringify(profileTop.slice(0, 3)))
    }
  } finally {
    spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
  }
}

console.log(failures === 0 ? 'ALL PASSED' : 'FAILED: ' + failures)
process.exit(failures === 0 ? 0 : 1)

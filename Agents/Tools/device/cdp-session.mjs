// node cdp-session.mjs <port> <command> [options]
// A persistent CDP client for one forwarded WebView devtools port (cdp.mjs evaluates one expression and exits).
//
//   eval -e <expression> | -f <file>                       same as cdp.mjs: prints the JSON value
//   profile --seconds <n> --out <file.cpuprofile> [--interval-us 1000]
//                                                          CPU sampling profile; also writes <out>.top.json (top 20 functions
//                                                          by self time) and <out>.groups.json (self time grouped by script URL)
//   probe --probe <probe.js> --seconds <n> --out <file.json> [--console-filter <regex>] [--label <text>] [--probe-opts <json>]
//                                                          loads the probe file (it defines window.__devb32Probe), calls
//                                                          start(label, opts), collects matching console events with timestamps
//                                                          from every execution context for n seconds, calls stop() and writes
//                                                          the probe JSON together with the events
//                                                          --no-runtime (flag, no value): sends no Runtime.enable and collects no
//                                                          console events (events is []), so the page's console stays unobserved
//                                                          while the probe is injected through Runtime.evaluate, as eval does
//   --timeout <ms>                                         global; default per command is its duration + 15 s
//
// Invariant: the process always ends within the timeout, whatever the target does.
// Exit codes: 0 done, 2 not exactly one page target (the targets are listed), 3 timed out, 4 connection, protocol,
// evaluation or usage error.
// Safety: only the methods in ALLOWED_METHODS are ever sent, and send() refuses any other name. The tool opens no page, changes
// no page location, injects no input and reads no storage. It connects to 127.0.0.1 only and forwards no port. It prints
// paths and counts, never what the probe or the page returned.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const ALLOWED_METHODS = new Set([
  'Runtime.enable', 'Runtime.disable', 'Runtime.evaluate',
  'Profiler.enable', 'Profiler.disable', 'Profiler.setSamplingInterval', 'Profiler.start', 'Profiler.stop',
])

const FLAG_OPTIONS = new Set(['--no-runtime'])

const fail = (code, text) => { console.error(text); process.exit(code) }

function parseArguments(argv) {
  const port = argv[0]
  const command = argv[1]
  const options = {}
  for (let i = 2; i < argv.length; i++) {
    const name = argv[i]
    if (!name.startsWith('-')) fail(4, 'unexpected argument ' + name)
    if (FLAG_OPTIONS.has(name)) options[name] = true
    else options[name] = argv[++i]
  }
  return { port, command, options }
}

function numberOption(options, name, fallback) {
  if (options[name] === undefined) return fallback
  const value = Number(options[name])
  if (!Number.isFinite(value) || value <= 0) fail(4, name + ' must be a positive number')
  return value
}

const { port, command, options } = parseArguments(process.argv.slice(2))
if (!/^\d+$/.test(String(port)) || !['eval', 'profile', 'probe'].includes(command)) {
  fail(4, 'usage: node cdp-session.mjs <port> (eval|profile|probe) [options]; see the header of this file')
}

const seconds = command === 'eval' ? 0 : numberOption(options, '--seconds', 0)
if (command !== 'eval' && seconds === 0) fail(4, command + ' needs --seconds <n>')
if (command !== 'eval' && !options['--out']) fail(4, command + ' needs --out <file>')
const timeoutMs = numberOption(options, '--timeout', command === 'eval' ? 10000 : seconds * 1000 + 15000)
setTimeout(() => fail(3, 'timeout after ' + timeoutMs + ' ms'), timeoutMs)

function writeOutput(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}

// target discovery: exactly one page target that is not a devtools page
let targets
try {
  const response = await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(timeoutMs) })
  targets = await response.json()
} catch (error) {
  fail(error && error.name === 'TimeoutError' ? 3 : 4, 'target list failed: ' + (error && error.message))
}
const pages = targets.filter((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'))
if (pages.length !== 1) {
  fail(2, (pages.length === 0 ? 'no page target ' : 'more than one page target ') + JSON.stringify(targets.map((t) => [t.type, t.url])))
}
const wsUrl = new URL(pages[0].webSocketDebuggerUrl)
wsUrl.hostname = '127.0.0.1'
wsUrl.port = String(port)

const socket = new WebSocket(wsUrl.href)
const pending = new Map()
const eventListeners = []
let nextId = 1
socket.onerror = () => fail(4, 'socket error')
socket.onclose = () => fail(4, 'socket closed before the command finished')
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== undefined) {
    const slot = pending.get(message.id)
    if (!slot) return
    pending.delete(message.id)
    if (message.error) slot.reject(new Error('protocol error ' + JSON.stringify(message.error)))
    else slot.resolve(message.result)
  } else if (message.method) {
    for (const listener of eventListeners) listener(message)
  }
}
const opened = new Promise((resolve) => { socket.onopen = resolve })

function send(method, params = {}) {
  if (!ALLOWED_METHODS.has(method)) throw new Error('method not allowed: ' + method)
  const id = nextId++
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result && result.exceptionDetails) throw new Error('evaluation threw ' + JSON.stringify(result.exceptionDetails))
  return result?.result?.value ?? result
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// self time per sample: a sample lasts until the next sample (timeDeltas[i + 1])
function selfTimes(profile) {
  const nodeById = new Map(profile.nodes.map((node) => [node.id, node]))
  const selfMsByNode = new Map()
  const { samples, timeDeltas } = profile
  for (let i = 0; i < samples.length; i++) {
    const ms = (i + 1 < samples.length ? timeDeltas[i + 1] : 0) / 1000
    selfMsByNode.set(samples[i], (selfMsByNode.get(samples[i]) ?? 0) + ms)
  }
  const functions = new Map()
  const urls = new Map()
  let total = 0
  for (const [id, ms] of selfMsByNode) {
    const frame = nodeById.get(id)?.callFrame ?? { functionName: '(unknown)', url: '', lineNumber: -1 }
    const name = frame.functionName || '(anonymous)'
    const key = name + '|' + frame.url + '|' + frame.lineNumber
    const entry = functions.get(key) ?? { name, url: frame.url, line: frame.lineNumber + 1, selfMs: 0 }
    entry.selfMs += ms
    functions.set(key, entry)
    urls.set(frame.url, (urls.get(frame.url) ?? 0) + ms)
    total += ms
  }
  const pct = (ms) => (total > 0 ? Math.round(ms / total * 10000) / 100 : 0)
  const round = (ms) => Math.round(ms * 1000) / 1000
  const top = [...functions.values()].sort((a, b) => b.selfMs - a.selfMs).slice(0, 20)
    .map((f) => ({ name: f.name, url: f.url, line: f.line, selfMs: round(f.selfMs), selfPct: pct(f.selfMs) }))
  const groups = [...urls.entries()].sort((a, b) => b[1] - a[1])
    .map(([url, ms]) => ({ url, selfMs: round(ms), selfPct: pct(ms) }))
  return { top, groups, totalMs: round(total) }
}

async function runEval() {
  let expression = options['-e']
  if (options['-f'] !== undefined) expression = readFileSync(options['-f'], 'utf8')
  if (expression === undefined) fail(4, 'eval needs -e <expression> or -f <file>')
  console.log(JSON.stringify(await evaluate(expression)))
}

async function runProfile() {
  const out = options['--out']
  const intervalUs = numberOption(options, '--interval-us', 1000)
  await send('Profiler.enable')
  await send('Profiler.setSamplingInterval', { interval: intervalUs })
  await send('Profiler.start')
  await sleep(seconds * 1000)
  const { profile } = await send('Profiler.stop')
  writeOutput(out, JSON.stringify(profile))
  const { top, groups, totalMs } = selfTimes(profile)
  writeOutput(out + '.top.json', JSON.stringify({ totalMs, top }, null, 2))
  writeOutput(out + '.groups.json', JSON.stringify({ totalMs, groups }, null, 2))
  console.log(JSON.stringify({ profile: out, samples: profile.samples.length, totalMs }))
}

function consoleText(args) {
  return args.map((a) => (a.value !== undefined ? String(a.value) : (a.description ?? a.type))).join(' ')
}

async function runProbe() {
  const out = options['--out']
  const probeSource = readFileSync(options['--probe'] ?? fail(4, 'probe needs --probe <probe.js>'), 'utf8')
  const filter = options['--console-filter'] === undefined ? null : new RegExp(options['--console-filter'])
  const label = options['--label'] ?? 'probe'
  const probeOptions = options['--probe-opts'] === undefined ? {} : JSON.parse(options['--probe-opts'])
  const noRuntime = options['--no-runtime'] === true
  const events = []
  if (!noRuntime) {
    eventListeners.push((message) => {
      if (message.method !== 'Runtime.consoleAPICalled') return
      const text = consoleText(message.params.args ?? [])
      if (filter !== null && !filter.test(text)) return
      events.push({ timestamp: message.params.timestamp, executionContextId: message.params.executionContextId, type: message.params.type, text })
    })
    await send('Runtime.enable')
  }
  await evaluate(probeSource)
  // one read of both clocks maps an event's epoch timestamp (ms) onto the page clock: pageMs = pagePerfMs + (timestamp - pageDateMs)
  const clocks = await evaluate('({ pagePerfMs: performance.now(), pageDateMs: Date.now() })')
  await evaluate('window.__devb32Probe.start(' + JSON.stringify(label) + ', ' + JSON.stringify(probeOptions) + ')')
  await sleep(seconds * 1000)
  const probeResult = JSON.parse(await evaluate('JSON.stringify(window.__devb32Probe.stop())'))
  // Runtime.enable replays console messages buffered before this run; only events at or after the clock read belong to it
  const kept = events.filter((event) => event.timestamp >= clocks.pageDateMs)
  for (const event of kept) event.pageMs = clocks.pagePerfMs + (event.timestamp - clocks.pageDateMs)
  writeOutput(out, JSON.stringify({ clocks, events: kept, probe: probeResult }, null, 2))
  console.log(JSON.stringify({ out, events: kept.length }))
}

try {
  await opened
  if (command === 'eval') await runEval()
  else if (command === 'profile') await runProfile()
  else await runProbe()
} catch (error) {
  fail(4, String(error && error.message))
}
process.exit(0)

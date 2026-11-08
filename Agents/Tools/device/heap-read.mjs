// node heap-read.mjs <port> --label <text> [--gc] [--timeout <ms>]
// One read of the page's JS heap and DOM counters over a forwarded WebView or Chrome devtools port, one JSON line on stdout:
//   {"label","before":{"usedSize","totalSize","nodes","documents","jsEventListeners"}}
// With --gc the page is collected after the first read and the same five numbers are read again as "after":
//   Runtime.getHeapUsage, Memory.getDOMCounters, HeapProfiler.collectGarbage, Runtime.getHeapUsage, Memory.getDOMCounters (in that order).
// Without --gc no collection is requested. A number the target does not report is null, never 0.
//
// Invariants: connects to 127.0.0.1 only; exactly one page target that is not a devtools page, otherwise exit 2 with the target list;
// only the three methods above are ever sent (send() refuses any other name); it opens no page, injects no input and reads no storage;
// it prints the label and numbers, never page content. --label accepts A-Z a-z 0-9 . _ - (1 to 64 characters).
// Exit codes: 0 done, 2 not exactly one page target, 3 timed out, 4 connection, protocol or usage error. Default timeout 15 s.
const ALLOWED_METHODS = new Set(['Runtime.getHeapUsage', 'Memory.getDOMCounters', 'HeapProfiler.collectGarbage'])

const fail = (code, text) => { console.error(text); process.exit(code) }

const argv = process.argv.slice(2)
const port = argv[0]
const options = {}
for (let i = 1; i < argv.length; i++) {
  const name = argv[i]
  if (name === '--gc') options.gc = true
  else if (name === '--label' || name === '--timeout') options[name] = argv[++i]
  else fail(4, 'unexpected argument ' + name)
}
if (!/^\d+$/.test(String(port))) fail(4, 'usage: node heap-read.mjs <port> --label <text> [--gc] [--timeout <ms>]')
if (!/^[A-Za-z0-9._-]{1,64}$/.test(String(options['--label'] ?? ''))) fail(4, '--label is required: 1 to 64 characters from A-Z a-z 0-9 . _ -')
const timeoutMs = options['--timeout'] === undefined ? 15000 : Number(options['--timeout'])
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail(4, '--timeout must be a positive number')
setTimeout(() => fail(3, 'timeout after ' + timeoutMs + ' ms'), timeoutMs)

let targets
try {
  const response = await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(timeoutMs) })
  targets = await response.json()
} catch (error) {
  fail(error && error.name === 'TimeoutError' ? 3 : 4, 'target list failed: ' + (error && error.message))
}
const pages = targets.filter((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'))
if (pages.length !== 1) {
  fail(2, (pages.length === 0 ? 'no page target ' : 'more than one page target ') + JSON.stringify(targets.map((t) => [t.type])))
}
const wsUrl = new URL(pages[0].webSocketDebuggerUrl)
wsUrl.hostname = '127.0.0.1'
wsUrl.port = String(port)

const socket = new WebSocket(wsUrl.href)
const pending = new Map()
let nextId = 1
socket.onerror = () => fail(4, 'socket error')
socket.onclose = () => fail(4, 'socket closed before the read finished')
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id === undefined) return
  const slot = pending.get(message.id)
  if (!slot) return
  pending.delete(message.id)
  if (message.error) slot.reject(new Error('protocol error ' + JSON.stringify(message.error)))
  else slot.resolve(message.result)
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

const numberOrNull = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : null)

async function readOnce() {
  const heap = await send('Runtime.getHeapUsage')
  const counters = await send('Memory.getDOMCounters')
  return {
    usedSize: numberOrNull(heap?.usedSize), totalSize: numberOrNull(heap?.totalSize),
    nodes: numberOrNull(counters?.nodes), documents: numberOrNull(counters?.documents), jsEventListeners: numberOrNull(counters?.jsEventListeners),
  }
}

try {
  await opened
  const line = { label: options['--label'], before: await readOnce() }
  if (options.gc === true) {
    await send('HeapProfiler.collectGarbage')
    line.after = await readOnce()
  }
  console.log(JSON.stringify(line))
} catch (error) {
  fail(4, String(error && error.message))
}
process.exit(0)

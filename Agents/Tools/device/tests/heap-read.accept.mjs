// node Agents/Tools/device/tests/heap-read.accept.mjs
// Acceptance test of heap-read.mjs on the PC, no device and no browser: a fake CDP server (node:http plus the repository's ws
// package) that records the methods it receives. Env: HEAP_READ_PATH (another copy of the tool, for mutant runs).
// Plain asserts print PASS/FAIL; exit 0 only if every assert holds.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..')
const TOOL = process.env.HEAP_READ_PATH ?? path.join(HERE, '..', 'heap-read.mjs')
const { WebSocketServer } = createRequire(path.join(REPO_ROOT, 'package.json'))('ws')

let failures = 0
const check = (ok, name, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : (detail ? ' :: ' + detail : '')))
  if (!ok) failures++
}

if (!existsSync(TOOL)) {
  console.log('FAIL the tool does not exist: ' + TOOL)
  process.exit(1)
}

function runTool(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

// The fake reports different numbers before and after a collectGarbage call, and distinct numbers for every field, so a swapped
// or misread field shows. advertisedHost is what the target list claims for the websocket host; the tool must still use 127.0.0.1.
function startFake({ pageCount = 1, advertisedHost = '127.0.0.1' } = {}) {
  const methods = []
  let collected = false
  const server = http.createServer((request, response) => {
    if (request.url === '/json') {
      const address = server.address()
      const targets = []
      for (let i = 0; i < pageCount; i++) targets.push({ type: 'page', url: 'http://fake/page' + i, webSocketDebuggerUrl: 'ws://' + advertisedHost + ':1/devtools/page/' + i })
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
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw))
      methods.push(message.method)
      const reply = (result) => socket.send(JSON.stringify({ id: message.id, result }))
      if (message.method === 'Runtime.getHeapUsage') reply(collected ? { usedSize: 61000000, totalSize: 90000000 } : { usedSize: 123000000, totalSize: 150000000 })
      else if (message.method === 'Memory.getDOMCounters') reply(collected ? { documents: 2, nodes: 4800, jsEventListeners: 70 } : { documents: 3, nodes: 52000, jsEventListeners: 710 })
      else if (message.method === 'HeapProfiler.collectGarbage') { collected = true; reply({}) }
      else socket.send(JSON.stringify({ id: message.id, error: { code: -32601, message: 'unexpected method' } }))
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    resolve({ port: server.address().port, methods, close: () => { for (const c of wss.clients) c.terminate(); server.close() } })
  }))
}

// T11 order, field mapping, and the no-gc form
{
  const fake = await startFake()
  const withGc = await runTool([String(fake.port), '--label', 'with-gc', '--gc'])
  check(withGc.code === 0, 'T11 --gc exits 0', withGc.code + ' ' + withGc.stderr)
  check(fake.methods.join() === ['Runtime.getHeapUsage', 'Memory.getDOMCounters', 'HeapProfiler.collectGarbage', 'Runtime.getHeapUsage', 'Memory.getDOMCounters'].join(),
    'T11 --gc sends getHeapUsage, getDOMCounters, collectGarbage, getHeapUsage, getDOMCounters in that order', fake.methods.join())
  const line = JSON.parse(withGc.stdout)
  check(line.label === 'with-gc' && line.before.usedSize === 123000000 && line.before.totalSize === 150000000 && line.before.nodes === 52000 && line.before.documents === 3 && line.before.jsEventListeners === 710,
    'T11 the before read maps usedSize, totalSize, nodes, documents and jsEventListeners to the right fields', withGc.stdout)
  check(line.after.usedSize === 61000000 && line.after.totalSize === 90000000 && line.after.nodes === 4800 && line.after.documents === 2 && line.after.jsEventListeners === 70,
    'T11 the after read follows the collection (smaller heap and fewer nodes) with the same mapping', withGc.stdout)
  fake.methods.length = 0
  const noGc = await runTool([String(fake.port), '--label', 'no-gc'])
  const noGcLine = JSON.parse(noGc.stdout)
  check(noGc.code === 0 && !fake.methods.includes('HeapProfiler.collectGarbage') && fake.methods.length === 2 && noGcLine.after === undefined,
    'T11 without --gc there is no collectGarbage, no after read, and exactly two calls', fake.methods.join())
  fake.close()
}

// T12 target selection and the loopback rule
{
  const none = await startFake({ pageCount: 0 })
  const noPage = await runTool([String(none.port), '--label', 'none'])
  check(noPage.code === 2 && noPage.stdout === '', 'T12 no page target (a devtools page and a service worker do not count) exits 2 with no output', noPage.code + ' ' + noPage.stderr)
  none.close()
  const two = await startFake({ pageCount: 2 })
  const twoPages = await runTool([String(two.port), '--label', 'two'])
  check(twoPages.code === 2 && two.methods.length === 0, 'T12 two page targets exit 2 and the tool sends nothing', twoPages.code + ' ' + two.methods.join())
  two.close()
  const foreign = await startFake({ advertisedHost: 'evil.example' })
  const rewritten = await runTool([String(foreign.port), '--label', 'loopback'])
  check(rewritten.code === 0 && foreign.methods.length === 2, 'T12 a target list that advertises another host and port is still read at 127.0.0.1 and the listed port', rewritten.code + ' ' + rewritten.stderr)
  foreign.close()
}

// usage errors
{
  const fake = await startFake()
  const noLabel = await runTool([String(fake.port)])
  check(noLabel.code === 4 && fake.methods.length === 0, 'a missing --label exits 4 before any call')
  const badLabel = await runTool([String(fake.port), '--label', 'has space'])
  check(badLabel.code === 4 && fake.methods.length === 0, 'a label outside A-Z a-z 0-9 . _ - exits 4 before any call')
  const extra = await runTool([String(fake.port), '--label', 'x', '--page', 'y'])
  check(extra.code === 4, 'an unknown option exits 4')
  fake.close()
}

console.log(failures === 0 ? 'ALL PASSED' : 'FAILED: ' + failures)
process.exit(failures === 0 ? 0 : 1)

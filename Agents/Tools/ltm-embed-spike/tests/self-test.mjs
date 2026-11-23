// node tests/self-test.mjs
// Device-free checks: serve.mjs headers, 404 logging and traversal refusal; probe.js as one expression in a bare vm context
// with stubbed browser globals and a fake worker that answers init and embed.
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { createSpikeServer } from '../serve.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const toolDir = join(here, '..')
const scratch = mkdtempSync(join(tmpdir(), 'ltm-embed-selftest-'))
const results = []
const check = async (name, fn) => {
  try { await fn(); results.push('ok   ' + name) } catch (error) { results.push('FAIL ' + name + ': ' + error.message); process.exitCode = 1 }
}

// serve.mjs
const root = join(scratch, 'root')
mkdirSync(join(root, 'models'), { recursive: true })
writeFileSync(join(root, 'a.wasm'), 'wasm')
writeFileSync(join(root, 'b.mjs'), 'export {}')
writeFileSync(join(root, 'models', 'c.json'), '{}')
writeFileSync(join(scratch, 'secret.txt'), 'outside')
const logFile = join(scratch, 'serve.log')
writeFileSync(logFile, '')
const server = createSpikeServer(root, logFile)
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = 'http://127.0.0.1:' + server.address().port

await check('serve: wasm MIME and CORS headers', async () => {
  const r = await fetch(origin + '/a.wasm')
  assert.equal(r.status, 200)
  assert.equal(r.headers.get('content-type'), 'application/wasm')
  assert.equal(r.headers.get('access-control-allow-origin'), '*')
  assert.equal(r.headers.get('cross-origin-resource-policy'), 'cross-origin')
  assert.equal(r.headers.get('cache-control'), 'no-store')
  assert.equal(await r.text(), 'wasm')
})
await check('serve: mjs and json MIME', async () => {
  assert.equal((await fetch(origin + '/b.mjs')).headers.get('content-type'), 'text/javascript')
  assert.equal((await fetch(origin + '/models/c.json')).headers.get('content-type'), 'application/json')
})
await check('serve: OPTIONS preflight 204 with CORS', async () => {
  const r = await fetch(origin + '/a.wasm', { method: 'OPTIONS' })
  assert.equal(r.status, 204)
  assert.equal(r.headers.get('access-control-allow-origin'), '*')
})
await check('serve: 404 is logged and still carries CORS', async () => {
  const r = await fetch(origin + '/missing.bin')
  assert.equal(r.status, 404)
  assert.equal(r.headers.get('access-control-allow-origin'), '*')
  assert.match(readFileSync(logFile, 'utf8'), /404 \/missing\.bin/)
})
await check('serve: traversal (raw, encoded, sibling-prefix) refused', async () => {
  for (const path of ['/..%2fsecret.txt', '/%2e%2e/secret.txt', '/..%5csecret.txt', '/models/..%2f..%2fsecret.txt', '/%00']) {
    const r = await fetch(origin + path)
    assert.equal(r.status, 404, path)
    assert.notEqual(await r.text(), 'outside', path)
  }
  const net = await import('node:net')
  const raw = await new Promise((done) => {
    const socket = net.connect(server.address().port, '127.0.0.1', () => socket.write('GET /../secret.txt HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n'))
    let data = ''
    socket.on('data', (chunk) => { data += chunk })
    socket.on('close', () => done(data))
  })
  assert.match(raw, /^HTTP\/1\.1 404/)
  assert.ok(!raw.includes('outside'))
})
server.close()

// probe.js
const probeSource = readFileSync(join(toolDir, 'probe.js'), 'utf8')
const makeContext = () => {
  const intervals = []
  const workers = []
  class FakeWorker {
    constructor(url, options) { this.url = url; this.options = options; this.posted = []; workers.push(this) }
    postMessage(message) {
      this.posted.push(message)
      if (message.type === 'init') queueMicrotask(() => this.onmessage({ data: { type: 'ready', loadMs: 12, dims: [1, 4] } }))
      if (message.type === 'embed') queueMicrotask(() => this.onmessage({ data: { type: 'done', id: message.id, ms: 5, n: message.texts.length, dim: 4, checksum: 0.5 } }))
    }
    terminate() { this.terminated = true }
  }
  class FakeObserver {
    constructor(callback) { this.callback = callback }
    observe(options) { this.options = options; FakeObserver.last = this }
    disconnect() { this.disconnected = true }
  }
  const window = { crossOriginIsolated: false }
  const context = {
    window,
    performance: { now: () => Date.now() % 1000000, memory: { usedJSHeapSize: 1, totalJSHeapSize: 2 } },
    PerformanceObserver: FakeObserver,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    setInterval: (fn) => { intervals.push(fn); return intervals.length },
    clearInterval: () => {},
    fetch: async () => ({ ok: true, text: async () => 'export {}' }),
    Blob: class { constructor(parts, options) { this.parts = parts; this.options = options } },
    URL: { createObjectURL: () => 'blob:fake' },
    Worker: FakeWorker,
    navigator: { deviceMemory: 4, hardwareConcurrency: 8, userAgent: 'stub' },
    location: { origin: 'http://tauri.localhost' },
    SharedArrayBuffer: class {},
    Math, Date, Promise, JSON, Object, Array, String, Number, Error,
  }
  window.window = window
  vm.createContext(context)
  return { context, workers, FakeObserver }
}

await check('probe: evaluates as one expression, idempotent, version string', async () => {
  const { context } = makeContext()
  const first = vm.runInContext(probeSource, context)
  assert.equal(typeof first, 'string')
  const api = context.window.__s3a
  const id = api.state.pageSessionId
  assert.equal(vm.runInContext(probeSource, context), first)
  assert.equal(context.window.__s3a.state.pageSessionId, id)
  for (const method of ['start', 'load', 'markPhase', 'runIndex', 'poll', 'snapshot', 'stop']) assert.equal(typeof api[method], 'function', method)
  assert.doesNotThrow(() => new vm.Script('(' + probeSource.replace(/^\/\/.*$/gm, '') + ')'), 'one expression')
})
await check('probe: start, load, runIndex through a fake worker; texts match the spec; results JSON-safe', async () => {
  const { context, workers, FakeObserver } = makeContext()
  vm.runInContext(probeSource, context)
  const api = context.window.__s3a
  const started = await api.start({ base: 'http://127.0.0.1:1', model: 'm', pooling: 'cls', dtype: 'q8' })
  assert.equal(started.ok, true)
  assert.equal(FakeObserver.last.options.type, 'longtask')
  assert.equal(workers[0].options.type, 'module')
  api.load()
  assert.deepEqual(JSON.parse(JSON.stringify(workers[0].posted[0])), { type: 'init', base: 'http://127.0.0.1:1', model: 'm', dtype: 'q8', threads: 1, pooling: 'cls' })
  await new Promise((done) => setImmediate(done))
  assert.equal(api.poll(0).ready, true)
  assert.equal(api.runIndex({ count: 50, batch: 8, seed: 7 }).ok, true)
  for (let i = 0; i < 200 && !api.state.index.finished; i++) await new Promise((done) => setImmediate(done))
  const poll = api.poll(0)
  assert.equal(poll.index.finished, true)
  assert.equal(poll.index.done, 50)
  assert.equal(poll.index.callMs.length, 7)
  const texts = workers[0].posted.filter((m) => m.type === 'embed').flatMap((m) => m.texts)
  assert.equal(texts.length, 50)
  const korean = texts.filter((t) => /[가-힣]/.test(t))
  const english = texts.filter((t) => !/[가-힣]/.test(t))
  assert.ok(korean.length > 0 && english.length > 0)
  assert.ok(korean.every((t) => t.length >= 160 && t.length <= 200), 'korean length')
  assert.ok(english.every((t) => t.split(' ').length >= 50 && t.split(' ').length <= 70), 'english words')
  const again = makeContext()
  vm.runInContext(probeSource, again.context)
  await again.context.window.__s3a.start({ base: 'http://127.0.0.1:1', model: 'm', pooling: 'cls' })
  again.context.window.__s3a.load()
  await new Promise((done) => setImmediate(done))
  again.context.window.__s3a.runIndex({ count: 50, batch: 8, seed: 7 })
  for (let i = 0; i < 200 && !again.context.window.__s3a.state.index.finished; i++) await new Promise((done) => setImmediate(done))
  const texts2 = again.workers[0].posted.filter((m) => m.type === 'embed').flatMap((m) => m.texts)
  assert.deepEqual(texts2, texts, 'same seed gives the same messages')
  const snapshot = api.snapshot()
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(snapshot))), JSON.stringify(snapshot))
  assert.ok('pageSessionId' in snapshot && 'longtasks' in snapshot && 'phaseStats' in snapshot)
  assert.ok(['idle-baseline', 'load', 'index'].every((name) => name in snapshot.phaseStats))
  assert.equal(api.stop().ok, true)
  assert.equal(workers[0].terminated, true)
})
await check('probe: Worker construction failure is reported, not hidden', async () => {
  const { context } = makeContext()
  context.Worker = class { constructor() { throw new Error('CSP blocked worker') } }
  vm.runInContext(probeSource, context)
  const started = await context.window.__s3a.start({ base: 'http://127.0.0.1:1', model: 'm', pooling: 'mean' })
  assert.equal(started.ok, false)
  assert.match(started.constructError, /CSP blocked worker/)
  assert.match(context.window.__s3a.snapshot().constructError, /CSP blocked worker/)
})

rmSync(scratch, { recursive: true, force: true })
console.log(results.join('\n'))
process.exit(process.exitCode || 0)

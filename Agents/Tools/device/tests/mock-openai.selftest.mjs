// node Agents/Tools/device/tests/mock-openai.selftest.mjs [--server <path to mock-openai.mjs>]
// Self-test of the mock endpoint: starts it on ephemeral ports and asserts its replies and its log. Needs no device and no network
// beyond 127.0.0.1. Plain asserts; exit code 0 only if every assert holds. --server points the test at another copy of the
// server (used to prove that a broken copy fails these tests).
// The SSE parser below is a copy of the data-line rule in getTranStream (src/ts/process/request/openAI/requests.ts); the real app
// remains the authority against drift.
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const serverIndex = args.indexOf('--server')
const serverPath = serverIndex >= 0 ? args[serverIndex + 1] : join(here, '..', 'mock-openai.mjs')
const work = mkdtempSync(join(tmpdir(), 'mock-openai-test-'))
let failures = 0
const children = []

function assert(condition, message) {
  if (condition) console.log('PASS ' + message)
  else { console.log('FAIL ' + message); failures++ }
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function startServer(name, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const logPath = join(work, name + '.log')
    const pidPath = join(work, name + '.pid')
    const child = spawn(process.execPath, [serverPath, '--port', '0', '--log', logPath, '--pid-file', pidPath, ...extraArgs], { stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let out = ''
    let err = ''
    const timer = setTimeout(() => reject(new Error('server ' + name + ' did not start: ' + out + err)), 5000)
    child.stderr.on('data', (d) => { err += d })
    child.stdout.on('data', (d) => {
      out += d
      const m = /listening 127\.0\.0\.1:(\d+) pid (\d+)/.exec(out)
      if (m) { clearTimeout(timer); resolve({ child, port: Number(m[1]), pid: Number(m[2]), logPath, pidPath }) }
    })
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error('server ' + name + ' exited ' + code + ': ' + err)) })
  })
}

function stopServer(server) {
  return new Promise((resolve) => {
    if (server.child.exitCode !== null) { resolve(); return }
    server.child.removeAllListeners('exit')
    server.child.on('exit', () => resolve())
    server.child.kill()
    setTimeout(resolve, 2000)
  })
}

// Resolves with the status, headers, each received body chunk and the whole body. Chunks follow the server's write boundaries
// because the response is chunk-framed.
function send(port, method, path, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const text = body === null ? null : (typeof body === 'string' ? body : JSON.stringify(body))
    const h = { ...headers }
    if (text !== null) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(text) }
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers: h, agent: false }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c.toString('utf8')))
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, chunks, body: chunks.join('') }))
    })
    req.on('error', reject)
    if (text !== null) req.write(text)
    req.end()
  })
}

function readLog(server) {
  if (!existsSync(server.logPath)) return []
  return readFileSync(server.logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
}
async function waitForLog(server, predicate, ms = 3000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const lines = readLog(server)
    if (predicate(lines)) return lines
    await sleep(25)
  }
  return readLog(server)
}

// Copy of the app's rule: split on newline, keep lines that start with "data: ", stop at [DONE], ignore a line that does not parse
// yet (it is still incomplete), and append content fragments the way appendStreamingFragment does.
function parseLikeApp(text) {
  let current = ''
  let done = false
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const raw = line.replace('data: ', '')
    if (raw === '[DONE]') { done = true; break }
    let choices
    try { choices = JSON.parse(raw).choices } catch { continue }
    for (const choice of choices) {
      const piece = choice.delta.content ?? choice.text
      if (piece) current = (piece.length > current.length && piece.startsWith(current)) ? piece : current + piece
    }
  }
  return { text: current, done }
}

function dataEvents(text) {
  return text.split('\n').filter((l) => l.startsWith('data: ') && l !== 'data: [DONE]').map((l) => JSON.parse(l.slice(6)))
}

try {
  const server = await startServer('main')

  // pid file and ping
  assert(existsSync(server.pidPath) && readFileSync(server.pidPath, 'utf8').trim() === String(server.pid), 'pid file: holds the server pid')
  const ping = await send(server.port, 'GET', '/__ping')
  assert(ping.status === 200 && JSON.parse(ping.body).ok === true, 'ping: GET /__ping answers 200 ok')
  const models = await send(server.port, 'GET', '/v1/models')
  assert(models.status === 200 && JSON.parse(models.body).data[0].id === 'mock-model', 'models: GET /v1/models lists one model')
  const nope = await send(server.port, 'GET', '/v1/other')
  const wrongMethod = await send(server.port, 'GET', '/v1/chat/completions')
  assert(nope.status === 404 && wrongMethod.status === 404, 'routing: an unknown path and a wrong method answer 404')

  // non-streaming JSON shape
  const plain = await send(server.port, 'POST', '/v1/chat/completions', { body: { model: 'x', stream: false, messages: [{ role: 'user', content: 'hi' }] } })
  const plainJson = JSON.parse(plain.body)
  assert(plain.status === 200 && /^application\/json/.test(plain.headers['content-type']), 'json: stream:false answers 200 application/json, not an event stream')
  assert(plainJson.choices[0].message.role === 'assistant' && plainJson.choices[0].message.content.includes('[mock-reply]') && plainJson.choices[0].finish_reason === 'stop', 'json: choices[0].message carries the assistant role, the reply marker and a stop reason')
  assert(/^[\x20-\x7e]+$/.test(plainJson.choices[0].message.content), 'json: the canned reply is printable ASCII')
  assert(plain.headers['access-control-allow-origin'] === '*' && plain.headers['access-control-allow-headers'] === '*' && /POST/.test(plain.headers['access-control-allow-methods']), 'cors: a normal response carries the allow origin, headers and methods')

  // streaming
  const sse = await send(server.port, 'POST', '/v1/chat/completions', { body: { model: 'x', stream: true, messages: [{ role: 'user', content: 'hi' }] } })
  assert(sse.status === 200 && /^text\/event-stream/.test(sse.headers['content-type']), 'sse: stream:true answers 200 text/event-stream')
  const events = dataEvents(sse.body)
  assert(events.length > 3 && sse.chunks.length > 1, 'sse: the events arrive in more than one write')
  assert(events[0].choices[0].delta.role === 'assistant' && events[0].choices[0].delta.content === undefined, 'sse: the first chunk is role-only, without content')
  const parsed = parseLikeApp(sse.body)
  assert(parsed.done && parsed.text.startsWith('[mock-reply] ') && parsed.text.length > 30 && !parsed.text.includes('undefined'), 'sse: the app rule reads the concatenated text and reaches [DONE]')
  assert(parsed.text === events.map((e) => e.choices[0].delta.content ?? '').join(''), 'sse: the concatenated text equals the joined delta contents')
  assert(sse.body.endsWith('data: [DONE]\n\n'), 'sse: the stream ends with the [DONE] event')
  const noNewline = parseLikeApp(sse.body.replace(/\s+$/, ''))
  assert(noNewline.done && noNewline.text === parsed.text, 'sse: the app rule still reaches [DONE] when the trailing newline is missing')
  // A line split across writes: some received chunk ends inside a data line, and reading chunk by chunk (as the app does) never loses text.
  let seen = ''
  let midLine = 0
  let rolling = ''
  for (const c of sse.chunks) {
    seen += c
    if (!seen.endsWith('\n')) midLine++
    rolling = parseLikeApp(seen).text
  }
  assert(midLine > 0, 'sse: at least one data line is split across two writes')
  assert(rolling === parsed.text, 'sse: reading write by write with the app rule gives the same text as reading it whole')

  // preflight and the request after it
  const pre = await send(server.port, 'OPTIONS', '/v1/chat/completions', { headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization, content-type' } })
  const allowed = String(pre.headers['access-control-allow-headers']).toLowerCase().split(',').map((s) => s.trim())
  assert(pre.status === 204 && allowed.includes('authorization') && allowed.includes('content-type'), 'preflight: 204 and both requested headers are allowed')
  assert(pre.headers['access-control-allow-origin'] === '*' && /POST/.test(pre.headers['access-control-allow-methods']), 'preflight: allow origin and methods are present')
  const bare = await send(server.port, 'OPTIONS', '/v1/chat/completions')
  assert(/authorization/.test(String(bare.headers['access-control-allow-headers'])) && /content-type/.test(String(bare.headers['access-control-allow-headers'])), 'preflight: without a requested header list it falls back to authorization and content-type')
  await send(server.port, 'POST', '/v1/chat/completions', { headers: { Authorization: 'Bearer mock-key' }, body: { messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }] } })
  await send(server.port, 'POST', '/v1/chat/completions', { body: { stream: true, messages: [] } })

  // log shape
  const lines1 = await waitForLog(server, (l) => l.filter((x) => x.event === 'request').length >= 10)
  const reqs = lines1.filter((x) => x.event === 'request')
  const authed = reqs.find((r) => r.messages === 2)
  assert(authed && authed.auth === true && authed.method === 'POST' && authed.path === '/v1/chat/completions' && authed.status === 200 && authed.stream === false && authed.bodyBytes > 0, 'log: a request line holds method, path, stream flag, auth present, body length, message count and status')
  assert(reqs.filter((r) => r.auth === false).length === reqs.length - 1, 'log: auth is true only for the request that carried Authorization')
  const streamed = reqs.find((r) => r.stream === true && r.messages === 0)
  assert(streamed && streamed.status === 200, 'log: the stream flag is recorded for a streaming request')
  assert(reqs.some((r) => r.status === 404) && reqs.some((r) => r.status === 204), 'log: 404 and preflight responses are logged')
  assert(lines1.filter((x) => x.event === 'connect').length >= 1, 'log: each accepted socket gets a connect line')

  // garbage bytes
  const before = readLog(server)
  const garbage = await new Promise((resolve) => {
    const s = connect(server.port, '127.0.0.1', () => s.write('x\n'))
    let got = ''
    s.on('data', (d) => { got += d })
    s.on('close', () => resolve(got))
    s.on('error', () => resolve(got))
    setTimeout(() => { s.destroy(); resolve(got) }, 3000)
  })
  const lines2 = await waitForLog(server, (l) => l.filter((x) => x.event === 'client-error').length >= 1)
  const newLines = lines2.slice(before.length)
  const connectIndex = newLines.findIndex((x) => x.event === 'connect')
  const errorIndex = newLines.findIndex((x) => x.event === 'client-error')
  assert(connectIndex >= 0 && errorIndex > connectIndex && !newLines.some((x) => x.event === 'request'), 'garbage: bytes that are not HTTP give a connect line and a client-error line, never a request line')
  assert(typeof newLines[errorIndex]?.bytes === 'number' && newLines[errorIndex].bytes > 0, 'garbage: the client-error line carries the byte count')
  assert(/^HTTP\/1\.1 400/.test(garbage), 'garbage: the client gets a 400 and the socket is closed')
  const afterGarbage = await send(server.port, 'GET', '/__ping')
  assert(afterGarbage.status === 200, 'garbage: the server still serves after the garbage client')
  // a client that hangs up in the middle of a request line also leaves a line
  const halfBefore = readLog(server).length
  await new Promise((resolve) => { const s = connect(server.port, '127.0.0.1', () => { s.write('POST /v1/chat/comp'); setTimeout(() => { s.destroy(); resolve() }, 50) }) })
  const lines3 = await waitForLog(server, (l) => l.slice(halfBefore).some((x) => x.event === 'client-error'))
  assert(lines3.slice(halfBefore).some((x) => x.event === 'client-error'), 'garbage: a client that hangs up mid-request leaves a client-error line')

  // the log never holds body text or header values
  const sentinelBody = 'SENTINEL-BODY-7f3a91'
  const sentinelKey = 'Bearer SENTINEL-KEY-c20e44'
  const sentinelQuery = 'SENTINEL-QUERY-5b18d0'
  await send(server.port, 'POST', '/v1/chat/completions?k=' + sentinelQuery, { headers: { Authorization: sentinelKey, 'X-Sentinel': 'SENTINEL-HEADER-1d9' }, body: { model: 'SENTINEL-MODEL-88a', messages: [{ role: 'user', content: sentinelBody }] } })
  await send(server.port, 'POST', '/v1/chat/completions', { headers: { Authorization: sentinelKey }, body: { stream: true, messages: [{ role: 'user', content: sentinelBody }] } })
  await sleep(100)
  const rawLog = readFileSync(server.logPath, 'utf8')
  assert(rawLog.includes('"path":"/v1/chat/completions"') && !/SENTINEL/.test(rawLog), 'log: no body text, header value, model name or query string reaches the log')
  const allowedKeys = new Set(['t', 'event', 'method', 'path', 'stream', 'auth', 'bodyBytes', 'messages', 'status', 'code', 'bytes'])
  assert(readLog(server).every((l) => Object.keys(l).every((k) => allowedKeys.has(k))), 'log: every line uses only the documented keys')
  await stopServer(server)

  // --fail-every
  const failing = await startServer('fail', ['--fail-every', '2'])
  const f1 = await send(failing.port, 'POST', '/v1/chat/completions', { body: { messages: [] } })
  const f2 = await send(failing.port, 'POST', '/v1/chat/completions', { body: { messages: [] } })
  const f3 = await send(failing.port, 'POST', '/v1/chat/completions', { body: { messages: [] } })
  const f4 = await send(failing.port, 'POST', '/v1/chat/completions', { body: { stream: true, messages: [] } })
  assert(f1.status === 200 && f2.status === 500 && f3.status === 200 && f4.status === 500, 'fail-every: every second chat request answers 500, streaming or not')
  assert(/error/.test(f2.body) && f2.headers['access-control-allow-origin'] === '*', 'fail-every: the 500 carries an error body and the cors headers')
  const failLog = await waitForLog(failing, (l) => l.filter((x) => x.event === 'request' && x.status === 500).length >= 2)
  assert(failLog.filter((x) => x.event === 'request' && x.status === 500).length === 2, 'fail-every: the 500 responses are logged with status 500')
  const ping2 = await send(failing.port, 'GET', '/__ping')
  assert(ping2.status === 200, 'fail-every: ping and models are never failed')

  // a second instance on the same port
  const duplicate = await new Promise((resolve) => {
    const child = spawn(process.execPath, [serverPath, '--port', String(failing.port)], { stdio: ['ignore', 'pipe', 'pipe'] })
    children.push(child)
    let err = ''
    child.stderr.on('data', (d) => { err += d })
    const timer = setTimeout(() => { child.kill(); resolve({ code: 'timeout', err }) }, 5000)
    child.on('exit', (code) => { clearTimeout(timer); resolve({ code, err }) })
  })
  assert(duplicate.code !== 0 && duplicate.code !== 'timeout' && /EADDRINUSE/.test(duplicate.err), 'port in use: a second instance on the same port exits non-zero and names EADDRINUSE')
  const stillServing = await send(failing.port, 'GET', '/__ping')
  assert(stillServing.status === 200, 'port in use: the first instance keeps serving')
  await stopServer(failing)

  // delays
  const slow = await startServer('slow', ['--delay-ms', '150', '--chunk-delay-ms', '80'])
  const t0 = Date.now()
  await send(slow.port, 'POST', '/v1/chat/completions', { body: { messages: [] } })
  const plainMs = Date.now() - t0
  const t1 = Date.now()
  await send(slow.port, 'POST', '/v1/chat/completions', { body: { stream: true, messages: [] } })
  const streamMs = Date.now() - t1
  assert(plainMs >= 140, 'delay-ms: a reply waits at least the delay')
  assert(streamMs >= 150 + 80 * 10, 'chunk-delay-ms: a stream waits between its chunks')
  await stopServer(slow)

  // SIGINT shutdown cannot be delivered to a child on Windows (the child is terminated at once), so it is only asserted elsewhere.
  if (process.platform !== 'win32') {
    const sig = await startServer('sig')
    const exited = new Promise((resolve) => { sig.child.removeAllListeners('exit'); sig.child.on('exit', (code) => resolve(code)) })
    sig.child.kill('SIGINT')
    const code = await Promise.race([exited, sleep(4000).then(() => 'timeout')])
    assert(code === 0 && !existsSync(sig.pidPath), 'sigint: the server exits 0 and removes its pid file')
  } else {
    console.log('SKIP sigint: Windows cannot deliver SIGINT to a child process')
  }
} catch (error) {
  console.log('FAIL test run threw: ' + (error && error.stack ? error.stack : error))
  failures++
} finally {
  for (const c of children) { if (c.exitCode === null) { try { c.kill() } catch { /* already gone */ } } }
  await sleep(200)
  rmSync(work, { recursive: true, force: true })
}
if (failures > 0) { console.log('FAILED: ' + failures); process.exit(1) }
console.log('ALL PASSED')
process.exit(0)

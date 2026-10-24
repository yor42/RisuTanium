// node mock-openai.mjs [--port <n>] [--delay-ms <n>] [--chunk-delay-ms <n>] [--fail-every <n>] [--seed <n>] [--log <path>] [--pid-file <path>]
// A canned OpenAI-style chat endpoint for synthetic-device checks. Node built-ins only; bound to 127.0.0.1.
// Endpoints: POST /v1/chat/completions (JSON, or SSE when the body has stream:true), GET /v1/models, GET /__ping,
// OPTIONS preflight on any path. Every other method and path pair answers 404.
// Invariants:
// - Every reply is canned ASCII and contains REPLY_MARKER, so a DOM check can find it without reading user data.
// - The log is JSON lines and never holds body text, header values or query strings; the Authorization header is only
//   reported as present or absent.
// - Garbage bytes on a socket are logged as a client-error line and never stop the server.
// - Exit codes: 0 after SIGINT or SIGTERM, 1 when the port is taken or the arguments are wrong.
import { createServer } from 'node:http'
import { appendFileSync, writeFileSync, rmSync } from 'node:fs'

const REPLY_MARKER = '[mock-reply]'
const MAX_BODY_BYTES = 32 * 1024 * 1024
const CANNED = [
  'Hello from the mock endpoint. This reply is canned text for a device check.',
  'The mock endpoint answers every message with fixed text, so a run never needs a real model.',
  'Nothing here depends on the request text. Only the reply marker identifies this answer.',
  'A short canned answer follows. It has several words so a stream arrives in several chunks.'
]

function usage(text) {
  console.error(text)
  console.error('usage: node mock-openai.mjs [--port <n>] [--delay-ms <n>] [--chunk-delay-ms <n>] [--fail-every <n>] [--seed <n>] [--log <path>] [--pid-file <path>]')
  process.exit(1)
}

const options = { port: 6250, delayMs: 0, chunkDelayMs: 0, failEvery: 0, seed: 0, log: null, pidFile: null }
const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const name = argv[i]
  const value = argv[++i]
  const number = Number(value)
  const wholeNumber = value !== undefined && Number.isInteger(number) && number >= 0
  if (name === '--port' && wholeNumber && number <= 65535) options.port = number
  else if (name === '--delay-ms' && wholeNumber) options.delayMs = number
  else if (name === '--chunk-delay-ms' && wholeNumber) options.chunkDelayMs = number
  else if (name === '--fail-every' && wholeNumber) options.failEvery = number
  else if (name === '--seed' && wholeNumber) options.seed = number
  else if (name === '--log' && value) options.log = value
  else if (name === '--pid-file' && value) options.pidFile = value
  else usage('bad argument ' + name + (value === undefined ? '' : ' ' + value))
}

function log(entry) {
  if (!options.log) return
  try {
    appendFileSync(options.log, JSON.stringify({ t: new Date().toISOString(), ...entry }) + '\n')
  } catch {
    // A full disk or a removed folder must not take the endpoint down.
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let chatCount = 0

function replyFor(index) {
  return REPLY_MARKER + ' ' + CANNED[(options.seed + index) % CANNED.length]
}

function corsHeaders(request) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  }
  if (request.method === 'OPTIONS') {
    // A browser treats * as no authorization grant, so a preflight names the headers it was asked about.
    headers['Access-Control-Allow-Headers'] = request.headers['access-control-request-headers'] || 'authorization, content-type'
    if (request.headers['access-control-request-private-network']) headers['Access-Control-Allow-Private-Network'] = 'true'
  }
  return headers
}

function readBody(request) {
  return new Promise((resolve) => {
    const parts = []
    let size = 0
    let tooLarge = false
    request.on('data', (part) => {
      size += part.length
      if (size > MAX_BODY_BYTES) tooLarge = true
      else parts.push(part)
    })
    request.on('end', () => resolve({ bytes: size, tooLarge, text: tooLarge ? '' : Buffer.concat(parts).toString('utf8') }))
    request.on('error', () => resolve({ bytes: size, tooLarge, text: '' }))
  })
}

function sendJson(request, response, status, value, entry) {
  const text = JSON.stringify(value)
  log({ event: 'request', ...entry, status })
  response.writeHead(status, { ...corsHeaders(request), 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) })
  response.end(text)
}

function sseEvents(index) {
  const words = replyFor(index).split(' ')
  const base = { id: 'mock-' + index, object: 'chat.completion.chunk', created: 0, model: 'mock-model' }
  const events = [{ ...base, choices: [{ index: 0, delta: { role: 'assistant' } }] }]
  words.forEach((word, position) => {
    events.push({ ...base, choices: [{ index: 0, delta: { content: word + (position < words.length - 1 ? ' ' : '') } }] })
  })
  events.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })
  return events
}

async function streamReply(request, response, index, entry) {
  log({ event: 'request', ...entry, status: 200 })
  response.writeHead(200, { ...corsHeaders(request), 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
  const events = sseEvents(index)
  for (let i = 0; i < events.length; i++) {
    const line = 'data: ' + JSON.stringify(events[i]) + '\n\n'
    if (i === 2) {
      // One data line arrives in two writes, so a client has to buffer across chunk boundaries.
      const cut = Math.floor(line.length / 2)
      response.write(line.slice(0, cut))
      await sleep(Math.max(options.chunkDelayMs, 5))
      response.write(line.slice(cut))
    } else {
      response.write(line)
    }
    if (response.destroyed) return
    await sleep(Math.max(options.chunkDelayMs, 1))
  }
  response.end('data: [DONE]\n\n')
}

async function handle(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1')
  const path = url.pathname
  const hasAuth = request.headers.authorization !== undefined
  const entry = { method: request.method, path, stream: false, auth: hasAuth, bodyBytes: 0, messages: null }

  if (request.method === 'OPTIONS') {
    log({ event: 'request', ...entry, status: 204 })
    response.writeHead(204, { ...corsHeaders(request), 'Content-Length': 0 })
    response.end()
    return
  }

  const body = await readBody(request)
  entry.bodyBytes = body.bytes
  if (options.delayMs > 0) await sleep(options.delayMs)

  if (request.method === 'GET' && path === '/__ping') {
    sendJson(request, response, 200, { ok: true, mock: 'openai' }, entry)
    return
  }
  if (request.method === 'GET' && path === '/v1/models') {
    sendJson(request, response, 200, { object: 'list', data: [{ id: 'mock-model', object: 'model', owned_by: 'mock' }] }, entry)
    return
  }
  if (request.method === 'POST' && path === '/v1/chat/completions') {
    if (body.tooLarge) {
      sendJson(request, response, 413, { error: { message: 'body too large' } }, entry)
      return
    }
    let parsed = null
    try { parsed = JSON.parse(body.text) } catch { parsed = null }
    if (parsed && typeof parsed === 'object') {
      entry.stream = parsed.stream === true
      if (Array.isArray(parsed.messages)) entry.messages = parsed.messages.length
    }
    const index = chatCount++
    if (options.failEvery > 0 && (index + 1) % options.failEvery === 0) {
      sendJson(request, response, 500, { error: { message: 'mock failure', type: 'mock_error' } }, entry)
      return
    }
    if (entry.stream) {
      await streamReply(request, response, index, entry)
      return
    }
    const content = replyFor(index)
    sendJson(request, response, 200, {
      id: 'mock-' + index,
      object: 'chat.completion',
      created: 0,
      model: 'mock-model',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: content.split(' ').length, total_tokens: 1 + content.split(' ').length }
    }, entry)
    return
  }
  sendJson(request, response, 404, { error: { message: 'not found' } }, entry)
}

const server = createServer((request, response) => {
  handle(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
})

server.on('connection', (socket) => {
  log({ event: 'connect' })
  // A reset socket must not become an uncaught exception.
  socket.on('error', () => {})
})
// Bytes that are not a valid request (a TLS handshake, the phone probe's x, a client that hung up mid-line) land here.
server.on('clientError', (error, socket) => {
  log({ event: 'client-error', code: error && error.code ? String(error.code) : 'parse-error', bytes: socket.bytesRead })
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n')
  else socket.destroy()
})

server.on('error', (error) => {
  console.error('mock-openai: ' + (error && error.code ? error.code : 'error') + ' on 127.0.0.1:' + options.port + ': ' + (error && error.message))
  process.exit(1)
})

function shutdown() {
  if (options.pidFile) {
    try { rmSync(options.pidFile, { force: true }) } catch { /* the pid file is a convenience */ }
  }
  server.close(() => process.exit(0))
  server.closeAllConnections()
  setTimeout(() => process.exit(0), 2000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

server.listen(options.port, '127.0.0.1', () => {
  if (options.pidFile) writeFileSync(options.pidFile, String(process.pid))
  console.log('mock-openai listening 127.0.0.1:' + server.address().port + ' pid ' + process.pid)
})

// node cdp.mjs <port> [--timeout <ms>] (-e "<expression>" | -f <file.js>)
// Evaluates one expression in the first page target of a forwarded WebView devtools port and prints the JSON value.
// Invariant: the process always ends within --timeout (default 10000 ms), whatever the target does.
// Exit codes: 0 value printed, 2 no page target, 3 timed out, 4 connection or protocol error.
import { readFileSync } from 'node:fs'

const argv = process.argv.slice(2)
const port = argv[0]
let timeout = 10000
let expression = null
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--timeout') timeout = Number(argv[++i])
  else if (argv[i] === '-e') expression = argv[++i]
  else if (argv[i] === '-f') expression = readFileSync(argv[++i], 'utf8')
}
if (!port || expression === null || !Number.isFinite(timeout) || timeout <= 0) {
  console.error('usage: node cdp.mjs <port> [--timeout <ms>] (-e <expression> | -f <file>)')
  process.exit(4)
}

const fail = (code, text) => { console.error(text); process.exit(code) }
setTimeout(() => fail(3, 'timeout after ' + timeout + ' ms'), timeout)

let targets
try {
  const response = await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(timeout) })
  targets = await response.json()
} catch (error) {
  fail(error && error.name === 'TimeoutError' ? 3 : 4, 'target list failed: ' + (error && error.message))
}
const page = targets.find((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'))
if (!page) fail(2, 'no page target ' + JSON.stringify(targets.map((t) => [t.type, t.url])))

const socket = new WebSocket(page.webSocketDebuggerUrl)
socket.onopen = () => socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate',
  params: { expression, awaitPromise: true, returnByValue: true } }))
socket.onerror = () => fail(4, 'socket error')
socket.onclose = () => fail(4, 'socket closed before a response')
socket.onmessage = (event) => {
  const message = JSON.parse(event.data)
  if (message.id !== 1) return
  if (message.error) fail(4, 'protocol error ' + JSON.stringify(message.error))
  if (message.result && message.result.exceptionDetails) fail(4, 'evaluation threw ' + JSON.stringify(message.result.exceptionDetails))
  console.log(JSON.stringify(message.result?.result?.value ?? message.result))
  process.exit(0)
}

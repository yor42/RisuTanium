// node interaction-timer.mjs <port> measure --package <android package> (--row N1|N3|N4|N4b | --selector <css>) [--min-count <n>]
//                                              [--max-ms <ms>] [--timeout <ms>] [--dry-run]
// In-page interaction timer for the DIRTY-RC device rows N1, N3, N4 and N4b (plan r4 "Bars"; MC-1325, MC-1331, MC-1332).
//
// What it times. A script run through one Runtime.evaluate installs a `pointerup` capture listener on window and takes
// start = performance.now() when the first pointerup after arming reaches it. The stop is "the target is present plus 2
// requestAnimationFrame callbacks": the target is present when `document.querySelectorAll(selector).length >= minCount` (a
// MutationObserver plus a rAF poll look for it), and the stop is the timestamp of the second rAF callback after that. The result is
// stop - start (`deltaMs`), plus `presentMs` (stop of the presence check, before the two frames) and `eventDeltaMs` (the same stop
// against the pointer event's own `timeStamp`, which is earlier than the listener when the main thread was busy).
//
// Who taps. This tool never injects input: CDP touch injection arrives late (about 300 ms against 16 ms for `adb input tap`), so
// the caller taps with `adb input tap` while this tool waits. Order: start `measure`, wait for the line "ARMED" on stderr, tap,
// read the JSON line on stdout. One run is one tap.
//
// Selectors are parameters. `--row` names a preset (row and minimum count only) whose selector is still TODO(evidence): lane B
// fixes the selectors against the release DOM, so a preset without `--selector` is refused. `--selector` overrides the preset's.
// A target already present when the timer is armed is reported as `presentAtArm: true` and the run is void (nothing is timed
// from a stale node); `void` is true whenever the run cannot be read as one measurement.
//
// Safety (MC-1306). Read-only: the only CDP method is Runtime.evaluate; the injected script adds two listeners/observers, reads
// the DOM and `performance.now()`, keeps its state on one window property and removes its listeners at the end. It reads and
// writes no localStorage, IndexedDB, cache or cookie, opens no page, changes no location and injects no input. It connects to
// 127.0.0.1 only, and only to the port it is given (its own port: the caller forwards a free port, never another agent's).
// It refuses to attach unless the target's DevTools `/json/version` reports `Android-Package` equal to --package, and there is
// exactly one page target that is not a devtools page. It prints numbers and flags, never page content.
// Exit codes: 0 done (check `void`), 2 not exactly one page target, 3 timed out, 4 connection, protocol, usage or identity error.
import { Script } from 'node:vm'
import { pathToFileURL } from 'node:url'

const ALLOWED_METHODS = new Set(['Runtime.evaluate'])
const PRESETS = {
  N1: { minCount: 1, selector: 'TODO(evidence): last message node of the 10k chat' },
  N3: { minCount: 20, selector: 'TODO(evidence): grid card' },
  N4: { minCount: 1, selector: 'TODO(evidence): Settings panel root' },
  N4b: { minCount: 1, selector: 'TODO(evidence): Modules panel root' },
}

const fail = (code, text) => { console.error(text); process.exit(code) }

function parseArguments(argv) {
  const port = argv[0]
  const command = argv[1]
  const options = {}
  for (let i = 2; i < argv.length; i++) {
    const name = argv[i]
    if (!name.startsWith('--')) fail(4, 'unexpected argument ' + name)
    if (name === '--dry-run') options[name] = true
    else options[name] = argv[++i]
  }
  return { port, command, options }
}

function positiveNumber(options, name, fallback) {
  if (options[name] === undefined) return fallback
  const value = Number(options[name])
  if (!Number.isFinite(value) || value <= 0) fail(4, name + ' must be a positive number')
  return value
}

// The page-side script. It returns a JSON string and leaves the live state on window.__risuInteractionTimer.
export function buildArmScript(selector, minCount, maxMs) {
  return `(() => {
  const SELECTOR = ${JSON.stringify(selector)}
  const MIN_COUNT = ${JSON.stringify(minCount)}
  const MAX_MS = ${JSON.stringify(maxMs)}
  const previous = window.__risuInteractionTimer
  if (previous && previous.disarm) previous.disarm()
  const state = { armed: true, result: null, disarm: null }
  const count = () => { try { return document.querySelectorAll(SELECTOR).length } catch { return -1 } }
  const presentAtArm = count() >= MIN_COUNT
  let observer = null
  let t0 = null
  let eventT0 = null
  let frames = 0
  let presentAt = null
  let done = false
  const finish = (extra) => {
    if (done) return
    done = true
    const result = { presentAtArm, selectorError: count() === -1, ...extra }
    result.void = presentAtArm || result.selectorError || result.timedOut === true
    state.result = result
    state.disarm()
  }
  const onFrame = (stamp) => {
    if (done) return
    if (presentAt === null) {
      if (stamp - t0 > MAX_MS) { finish({ timedOut: true, deltaMs: null, presentMs: null, eventDeltaMs: null }); return }
      if (count() >= MIN_COUNT) presentAt = performance.now()
    }
    if (presentAt !== null) {
      frames += 1
      if (frames >= 2) {
        finish({ timedOut: false, deltaMs: stamp - t0, presentMs: presentAt - t0, eventDeltaMs: stamp - eventT0 })
        return
      }
    }
    requestAnimationFrame(onFrame)
  }
  const onPointerUp = (event) => {
    if (t0 !== null) return
    t0 = performance.now()
    eventT0 = event.timeStamp
    observer = new MutationObserver(() => { if (presentAt === null && count() >= MIN_COUNT) presentAt = performance.now() })
    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true })
    requestAnimationFrame(onFrame)
  }
  window.addEventListener('pointerup', onPointerUp, { capture: true })
  state.disarm = () => {
    state.armed = false
    window.removeEventListener('pointerup', onPointerUp, { capture: true })
    if (observer) observer.disconnect()
  }
  window.__risuInteractionTimer = state
  return JSON.stringify({ armed: true, presentAtArm })
})()`
}

const READ_SCRIPT = 'JSON.stringify(window.__risuInteractionTimer ? { armed: window.__risuInteractionTimer.armed, result: window.__risuInteractionTimer.result } : null)'
const DISARM_SCRIPT = '(() => { const s = window.__risuInteractionTimer; if (s && s.disarm) s.disarm(); return JSON.stringify("disarmed") })()'

function main() {
  const { port, command, options } = parseArguments(process.argv.slice(2))
  if (!/^\d+$/.test(String(port)) || command !== 'measure') {
    fail(4, 'usage: node interaction-timer.mjs <port> measure --package <pkg> (--row N1|N3|N4|N4b | --selector <css>) [--min-count <n>] [--max-ms <ms>] [--timeout <ms>] [--dry-run]')
  }
  const packageName = options['--package']
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(String(packageName ?? ''))) fail(4, '--package is required: an Android package name')
  const preset = options['--row'] === undefined ? null : PRESETS[options['--row']]
  if (options['--row'] !== undefined && preset === undefined) fail(4, '--row must be one of ' + Object.keys(PRESETS).join(', '))
  const selector = options['--selector'] ?? preset?.selector
  if (!selector) fail(4, 'give --row or --selector')
  if (selector.startsWith('TODO(evidence)')) fail(4, 'the selector of this row is still TODO(evidence): lane B fixes it against the release DOM; pass --selector')
  const minCount = positiveNumber(options, '--min-count', preset?.minCount ?? 1)
  const maxMs = positiveNumber(options, '--max-ms', 20000)
  const timeoutMs = positiveNumber(options, '--timeout', 60000)
  const script = buildArmScript(selector, minCount, maxMs)
  try { new Script(script) } catch (error) { fail(4, 'internal: the page script does not parse: ' + error.message) }
  if (options['--dry-run'] === true) {
    console.log(JSON.stringify({ dryRun: true, port: Number(port), package: packageName, selector, minCount, maxMs, timeoutMs, scriptBytes: script.length }))
    return
  }
  run({ port, packageName, script, timeoutMs })
}

async function run({ port, packageName, script, timeoutMs }) {
  // The timeout path disarms the page listener and observer (best effort, bounded) before it exits.
  let disarmOnTimeout = async () => {}
  setTimeout(async () => {
    await Promise.race([disarmOnTimeout().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 2000))])
    fail(3, 'timeout after ' + timeoutMs + ' ms')
  }, timeoutMs)
  let targets
  let version
  try {
    targets = await (await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(timeoutMs) })).json()
    version = await (await fetch('http://127.0.0.1:' + port + '/json/version', { signal: AbortSignal.timeout(timeoutMs) })).json()
  } catch (error) {
    fail(error && error.name === 'TimeoutError' ? 3 : 4, 'target list failed: ' + (error && error.message))
  }
  if (version['Android-Package'] !== packageName) {
    fail(4, 'identity mismatch: the target reports Android-Package ' + JSON.stringify(version['Android-Package'] ?? null) + ', expected ' + packageName)
  }
  const pages = targets.filter((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'))
  if (pages.length !== 1) fail(2, (pages.length === 0 ? 'no page target ' : 'more than one page target ') + JSON.stringify(targets.map((t) => [t.type])))
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
  const send = (method, params) => {
    if (!ALLOWED_METHODS.has(method)) throw new Error('method not allowed: ' + method)
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (response.exceptionDetails) throw new Error('evaluation threw')
    return JSON.parse(response.result.value)
  }
  try {
    await opened
    disarmOnTimeout = () => evaluate(DISARM_SCRIPT)
    const armed = await evaluate(script)
    console.error('ARMED presentAtArm=' + armed.presentAtArm)
    for (;;) {
      const state = await evaluate(READ_SCRIPT)
      if (state && state.result) {
        console.log(JSON.stringify({ package: packageName, ...state.result }))
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  } catch (error) {
    try { await evaluate(DISARM_SCRIPT) } catch { /* best effort */ }
    fail(4, String(error && error.message))
  }
  process.exit(0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()

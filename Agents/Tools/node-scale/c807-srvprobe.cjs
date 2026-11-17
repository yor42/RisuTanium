// CHORE-807 stage 4: a read-only probe for the repository's Node server (server/node/server.cjs), loaded as
//   NODE_OPTIONS=--require <this file>   (c807-keyscale.mjs passes it through startServer's env).
// It answers nothing and changes no response: every wrapper below calls the original with the same arguments and `this`, returns
// the original's value (or rejection) unchanged, and only reads clocks and appends one JSON line per event to C807_PROBE_OUT
// (without that variable the probe does nothing). Times `t` are performance.now() milliseconds since the process start; `epoch`
// is Date.now() at the event, so a runner can place an event next to its own requests.
//
// Events (one JSON object per line):
//   load        the probe was loaded (`t` is the Node bootstrap time before any server code ran)
//   read        readFileSync of save/__revisions.json or save/__revisions.log: file, t0, ms, bytes
//   parse       JSON.parse of a string of at least C807_PROBE_PARSE_MIN characters (default 1,000,000) before listen: t0, ms, chars,
//               and with C807_PROBE_COUNT=1 the number of own keys of the result (counted after the clock stopped)
//   readdir     the startup readdirSync of the save dir: t0, ms, count
//   compact     a revision snapshot compaction: phase startup (sync fs) or runtime (fs/promises), t0 = the tmp snapshot open,
//               ms = until its rename into place has returned
//   listen-call / listening   the server's listen call and its listening event
//   gap         a 20 ms timer fired more than 50 ms after the previous tick: ms = the whole tick interval; first = the first
//               tick after the probe loaded, which spans the synchronous startup
//   eld         monitorEventLoopDelay over the last second (ms): min, mean, p50, p99, max
//   busy        the self-check knob C807_PROBE_BUSY_MS blocked the loop (see below)
// Self-check knobs (set only by c807-keyscale.mjs self-checks): C807_PROBE_BUSY_MS=<n> blocks the loop for n ms once, one second
// after listening, so the gap monitor has a known gap to find; C807_FAULT=lag-blind turns the gap monitor off.
'use strict'
const fs = require('fs')
const fsp = require('fs/promises')
const net = require('net')
const path = require('path')
const { performance, monitorEventLoopDelay } = require('perf_hooks')

const OUT = process.env.C807_PROBE_OUT
if (OUT) {
  const orig = {
    readFileSync: fs.readFileSync, readdirSync: fs.readdirSync, openSync: fs.openSync, renameSync: fs.renameSync,
    appendFileSync: fs.appendFileSync, parse: JSON.parse, popen: fsp.open, prename: fsp.rename, listen: net.Server.prototype.listen,
  }
  const now = () => performance.now()
  const emit = (event) => {
    try { orig.appendFileSync(OUT, JSON.stringify({ ...event, epoch: Date.now() }) + '\n') } catch {}
  }
  const PARSE_MIN = Number(process.env.C807_PROBE_PARSE_MIN ?? 1000000)
  const COUNT = process.env.C807_PROBE_COUNT === '1'
  const BLIND = process.env.C807_FAULT === 'lag-blind'
  const SAVE = path.join(process.cwd(), 'save')
  const sameDir = (p) => typeof p === 'string' && path.resolve(p).toLowerCase() === SAVE.toLowerCase()
  const baseOf = (p) => (typeof p === 'string' ? path.basename(p) : '')
  const TMP_PREFIX = '__revisions.json.tmp-'
  let listening = false
  let startupOpenT = null
  let runtimeOpenT = null

  emit({ ev: 'load', t: now(), pid: process.pid, node: process.version, timeOrigin: performance.timeOrigin })

  fs.readFileSync = function readFileSync(p) {
    const name = baseOf(p)
    if (name !== '__revisions.json' && name !== '__revisions.log') return Reflect.apply(orig.readFileSync, this, arguments)
    const t0 = now()
    const result = Reflect.apply(orig.readFileSync, this, arguments)
    const ms = now() - t0
    emit({ ev: 'read', file: name, t0, ms, bytes: typeof result === 'string' ? Buffer.byteLength(result) : result.length })
    return result
  }

  fs.readdirSync = function readdirSync(p) {
    if (listening || !sameDir(p)) return Reflect.apply(orig.readdirSync, this, arguments)
    const t0 = now()
    const result = Reflect.apply(orig.readdirSync, this, arguments)
    emit({ ev: 'readdir', t0, ms: now() - t0, count: result.length })
    return result
  }

  fs.openSync = function openSync(p) {
    if (baseOf(p).startsWith(TMP_PREFIX)) startupOpenT = now()
    return Reflect.apply(orig.openSync, this, arguments)
  }
  fs.renameSync = function renameSync(from, to) {
    const result = Reflect.apply(orig.renameSync, this, arguments)
    if (startupOpenT !== null && baseOf(from).startsWith(TMP_PREFIX) && baseOf(to) === '__revisions.json') {
      emit({ ev: 'compact', phase: 'startup', t0: startupOpenT, ms: now() - startupOpenT })
      startupOpenT = null
    }
    return result
  }
  fsp.open = function open(p) {
    if (baseOf(p).startsWith(TMP_PREFIX)) runtimeOpenT = now()
    return Reflect.apply(orig.popen, this, arguments)
  }
  fsp.rename = function rename(from, to) {
    const promise = Reflect.apply(orig.prename, this, arguments)
    if (runtimeOpenT === null || !baseOf(from).startsWith(TMP_PREFIX) || baseOf(to) !== '__revisions.json') return promise
    const t0 = runtimeOpenT
    return promise.then((value) => {
      emit({ ev: 'compact', phase: 'runtime', t0, ms: now() - t0 })
      runtimeOpenT = null
      return value
    })
  }

  // Only large strings are timed, only until the server listens; afterwards the original JSON.parse is back in place.
  JSON.parse = function parse(text) {
    if (typeof text !== 'string' || text.length < PARSE_MIN) return Reflect.apply(orig.parse, this, arguments)
    const t0 = now()
    let result
    try {
      result = Reflect.apply(orig.parse, this, arguments)
      return result
    } finally {
      const ms = now() - t0
      const event = { ev: 'parse', t0, ms, chars: text.length }
      if (COUNT && result !== null && typeof result === 'object') event.entries = Object.keys(result).length
      emit(event)
    }
  }

  net.Server.prototype.listen = function listen() {
    emit({ ev: 'listen-call', t: now() })
    this.once('listening', () => {
      listening = true
      JSON.parse = orig.parse
      emit({ ev: 'listening', t: now() })
      const busy = Number(process.env.C807_PROBE_BUSY_MS ?? 0)
      if (busy > 0) {
        setTimeout(() => {
          const t0 = now()
          emit({ ev: 'busy', t0, ms: busy })
          while (now() - t0 < busy) { /* blocks the loop on purpose for the gap-monitor self-check */ }
        }, 1000).unref()
      }
    })
    return Reflect.apply(orig.listen, this, arguments)
  }

  if (!BLIND) {
    let last = now()
    let first = true
    setInterval(() => {
      const t = now()
      const dt = t - last
      last = t
      if (dt > 50) emit({ ev: 'gap', t, ms: dt, first })
      first = false
    }, 20).unref()
  }
  const histogram = monitorEventLoopDelay({ resolution: 10 })
  histogram.enable()
  setInterval(() => {
    const ms = (ns) => ns / 1e6
    emit({ ev: 'eld', t: now(), min: ms(histogram.min), mean: ms(histogram.mean), p50: ms(histogram.percentile(50)), p99: ms(histogram.percentile(99)), max: ms(histogram.max) })
    histogram.reset()
  }, 1000).unref()
}

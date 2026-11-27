// node home-bench.mjs <port> <boot|return> --out <dir> [--runs N] [--pause-ms N]
//        [--tap "x,y"] [--enter "x,y"] [--home "x,y"] [--serial S --adbg-log L --own-ports P --package PKG]
//        [--ready-sel CSS] [--lib-sel CSS] [--chat-sel CSS] [--timeout-ms N]
// Home-interactive timer for #508 (G10 re-creation; the #234 harness was never kept). Runs on a phone through its
// WebView DevTools port (the caller forwards an own port) and sends taps only through device-guard/adbg.mjs.
//
// Definitions (one run):
//   anchor   boot:   the document's own time origin (performance.now() = 0 in the reloaded page).
//            return: the pointerup that taps the Home control (event.timeStamp), after the chat is shown.
//   T_paint  anchor -> landing present (--ready-sel) + 2 requestAnimationFrame callbacks (first frame of Home).
//   T_lib    anchor -> library mounted (--lib-sel present) + 2 rAF; null when it never mounts in the window.
//   T_resp   = T_paint (the Home answers: it is on screen and the next frame ran).
//   T_tap    a blank-spot tap (--tap) is sent the moment T_paint is reported; its input-to-second-frame time
//            (second rAF after the pointerup listener minus pointerup.timeStamp) is added to T_paint:
//            T_tap = T_paint + (tapFrame2 - tapEventStamp). It grows when the main thread is busy after first paint.
//   value    max(T_resp, T_tap) per run, reported as median (max) over the runs. This follows the #234 G10 run value
//            (MC-3120); the original probe is lost, so absolute numbers are re-baselined against build B on the same phone.
//   longtasks every Long Task entry (start, duration) in the run, so a mount burst is visible.
// Boot uses Page.addScriptToEvaluateOnNewDocument + Page.reload (a WebView document reload, warm process; it is not
// a process cold start). Safety: Page.reload/addScript and Runtime only; no storage read; no page content leaves the
// page (counts and times only); 127.0.0.1 only; the run always ends inside --timeout-ms per run.
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const port = args[0]
const route = args[1]
const opt = {}
for (let i = 2; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1]
const usage = () => { console.error('usage: node home-bench.mjs <port> <boot|return> --out <dir> [options], see header'); process.exit(4) }
if (!/^\d+$/.test(String(port)) || !['boot', 'return'].includes(route) || !opt.out) usage()
const runs = Number(opt.runs ?? 5)
const pauseMs = Number(opt['pause-ms'] ?? 8000)
const timeoutMs = Number(opt['timeout-ms'] ?? 30000)
const readySel = opt['ready-sel'] ?? '[data-part="home-landing"]'
const libSel = opt['lib-sel'] ?? '[data-part="home-library"]:not(:has([data-part="home-library-placeholder"]))'
const chatSel = opt['chat-sel'] ?? ''
const pt = (s) => { if (!s) return null; const m = /^(\d+),(\d+)$/.exec(s); if (!m) usage(); return [Number(m[1]), Number(m[2])] }
const tap = pt(opt.tap)
const enter = pt(opt.enter)
const home = pt(opt.home)
const pre = (opt.pre ?? '').split(';').filter(Boolean).map(pt)
if (route === 'return' && !(enter && home && chatSel)) usage()
const adbOn = !!(opt.serial && opt['adbg-log'] && opt['own-ports'] && opt.package)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function adbg(...rest) {
  if (!adbOn) return Promise.resolve('')
  return new Promise((resolve, reject) => {
    const guard = new URL('../device-guard/adbg.mjs', import.meta.url)
    const p = spawn(process.execPath, [guard.pathname.replace(/^\/([A-Za-z]:)/, '$1'), '--serial', opt.serial, '--log', opt['adbg-log'],
      '--own-ports', opt['own-ports'], '--own-package', opt.package, '--', ...rest], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    p.on('error', reject)
    p.on('close', (c) => (c === 0 ? resolve(out) : reject(new Error('adbg exit ' + c + ' ' + out.slice(0, 200)))))
  })
}
const tapAt = (xy) => adbg('shell', 'input', 'tap', String(xy[0]), String(xy[1]))

// Page probe. Reports through console.debug lines "HB <json>"; keeps its state on window.__hb.
function probeSource(anchorMode) {
  return `(() => {
  if (window.__hb && window.__hb.armed) return
  const S = window.__hb = { armed: true, anchor: ${anchorMode === 'boot' ? '0' : 'null'}, marks: {}, longtasks: [], tap: null }
  const say = (o) => console.debug('HB ' + JSON.stringify(o))
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) S.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]) }).observe({ type: 'longtask', buffered: true }) } catch (e) {}
  const after2 = (fn) => requestAnimationFrame(() => requestAnimationFrame(fn))
  const watch = (key, sel, gate) => {
    const check = () => {
      if (S.marks[key] != null || S.anchor == null) return
      if (!document.querySelector(sel)) return
      S.marks[key] = -1
      after2(() => { S.marks[key] = Math.round((performance.now() - S.anchor) * 10) / 10; say({ mark: key, ms: S.marks[key] }) })
    }
    new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true })
    S.check = (S.check || []); S.check.push(check); check()
  }
  S.arm = (anchor) => { S.anchor = anchor; S.marks = {}; S.tap = null; S.longtasks.length = 0; S.check.forEach((c) => c()) }
  watch('paint', ${JSON.stringify(readySel)})
  watch('lib', ${JSON.stringify(libSel)})
  window.addEventListener('pointerup', (e) => {
    if (S.armTap) {
      S.armTap = false
      const stamp = e.timeStamp
      after2(() => { S.tap = { event: Math.round(stamp * 10) / 10, frame2: Math.round(performance.now() * 10) / 10 }; say({ tap: S.tap }) })
    } else if (S.armAnchor) {
      S.armAnchor = false
      S.arm(e.timeStamp)
    }
  }, { capture: true, passive: true })
  S.ready = true
  say({ probe: 'ready' })
})()`
}

async function openSocket() {
  const targets = await (await fetch('http://127.0.0.1:' + port + '/json', { signal: AbortSignal.timeout(5000) })).json()
  const pages = targets.filter((t) => t.type === 'page' && !String(t.url).startsWith('devtools://'))
  if (pages.length !== 1) throw new Error('not exactly one page target: ' + pages.length)
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('socket error')) })
  let id = 0
  const waiting = new Map()
  const listeners = []
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.id && waiting.has(m.id)) { const w = waiting.get(m.id); waiting.delete(m.id); m.error ? w.rej(new Error(JSON.stringify(m.error))) : w.res(m.result) }
    else if (m.method) for (const l of listeners) l(m)
  }
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; waiting.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
  return { send, listeners, close: () => ws.close(), ws }
}

function hbLines(cdp, sink) {
  cdp.listeners.push((m) => {
    if (m.method !== 'Runtime.consoleAPICalled') return
    const a = m.params.args?.[0]?.value
    if (typeof a === 'string' && a.startsWith('HB ')) { try { sink(JSON.parse(a.slice(3))) } catch { /* not ours */ } }
  })
}

async function batteryTemp() {
  try { const o = await adbg('shell', 'dumpsys', 'battery'); const m = /temperature:\s*(\d+)/.exec(o); return m ? Number(m[1]) / 10 : null } catch { return null }
}

mkdirSync(opt.out, { recursive: true })
const results = []
const cdp = await openSocket()
await cdp.send('Runtime.enable')
const sink = { marks: {}, tap: null }
hbLines(cdp, (o) => { if (o.mark) sink.marks[o.mark] = o.ms; if (o.tap) sink.tap = o.tap })
const evalIn = async (expression) => (await cdp.send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value
const waitFor = async (pred, what, run) => { const t0 = Date.now(); while (!(await pred())) { if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for ' + what + ' (run ' + run + ')'); await sleep(25) } }
const startTemp = await batteryTemp()
for (let i = 0; i < runs; i++) {
  sink.marks = {}
  sink.tap = null
  const run = { index: i, route }
  try {
    if (route === 'boot') {
      await cdp.send('Page.enable')
      const added = await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: probeSource('boot') })
      await cdp.send('Page.reload', { ignoreCache: false })
      await waitFor(() => sink.marks.paint != null, 'paint', i)
      if (tap) {
        await evalIn('window.__hb.armTap = true')
        await tapAt(tap)
        await waitFor(() => sink.tap != null, 'tap frame', i)
      }
      await sleep(3500)
      run.longtasks = await evalIn('JSON.stringify(window.__hb.longtasks)')
      await cdp.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: added.identifier })
    } else {
      await evalIn(probeSource('return'))
      await tapAt(enter)
      await waitFor(async () => evalIn('!!document.querySelector(' + JSON.stringify(chatSel) + ')'), 'chat', i)
      await sleep(2500)
      for (const xy of pre) { await tapAt(xy); await sleep(1200) }
      await evalIn('(() => { const S = window.__hb; S.anchor = null; S.marks = {}; S.tap = null; S.armAnchor = true })()')
      sink.marks = {}
      await tapAt(home)
      await waitFor(() => sink.marks.paint != null, 'paint', i)
      if (tap) {
        await evalIn('window.__hb.armTap = true')
        await tapAt(tap)
        await waitFor(() => sink.tap != null, 'tap frame', i)
      }
      await sleep(3000)
      run.longtasks = await evalIn('JSON.stringify(window.__hb.longtasks)')
    }
  } catch (e) { run.error = String(e.message || e) }
  run.paint = sink.marks.paint ?? null
  run.lib = sink.marks.lib ?? null
  run.tapInputToFrame = sink.tap ? Math.round((sink.tap.frame2 - sink.tap.event) * 10) / 10 : null
  run.value = run.paint == null ? null : Math.round(Math.max(run.paint, run.paint + (run.tapInputToFrame ?? 0)))
  results.push(run)
  await sleep(pauseMs)
}
const endTemp = await batteryTemp()
const vals = results.map((r) => r.value).filter((v) => v != null).sort((a, b) => a - b)
const median = vals.length ? vals[Math.floor((vals.length - 1) / 2)] : null
const summary = { route, runs: results.length, median, max: vals.at(-1) ?? null, values: vals, batteryTempC: [startTemp, endTemp] }
writeFileSync(join(opt.out, route + '-results.json'), JSON.stringify({ summary, results }, null, 1))
console.log(JSON.stringify(summary))
cdp.close()
process.exit(results.every((r) => !r.error) ? 0 : 1)

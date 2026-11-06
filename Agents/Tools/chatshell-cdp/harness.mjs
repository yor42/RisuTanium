// UI-S1a chat shell CDP harness (desktop Chrome, phone emulation 360x740 DPR 2.8125, touch). DIAGNOSTIC: it injects a logger.
// usage: node harness.mjs --scenario H1|H2|H3|H7|H8|H12|H13|H14|H15|H15b|H16|RESET|T-A1 [--char name] [--out dir]
//        node harness.mjs --all [--out dir]     (--all runs H1 H2 H3 H7 H8 H12 H13 H14)
// Exit code 0 = every assertion of every run scenario passed (T-A1 only records fixtures). One JSON per scenario in --out.
// Argument errors exit 2 before any CDP connection. --out defaults to HARNESS_OUT, then a folder under the OS temp dir; a
// path inside the checkout is refused. T-A1 fixtures go to <out>/fixtures.
import fs from 'node:fs'
import path from 'node:path'
import { connect, sleep, phoneMode, desktopMode, openChat, outDir, TOOL_DIR } from './lib.mjs'

const argv = process.argv.slice(2)
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null }
let OUT = null   // resolved once, before the connection, in the validation block at the bottom
const BASE = process.env.HARNESS_BASE || 'unknown'
// Profile fixtures: sidebar slot (CSS y of the character icon) per character name; the fixture profile must hold these characters.
const CHAR_SLOTS = { 'default': 89, 'H15 Alt Greetings': 157 }
const CHAR = arg('--char') || (/^H15/.test(arg('--scenario') || '') ? 'H15 Alt Greetings' : 'default')
if (!(CHAR in CHAR_SLOTS)) { console.error('unknown --char ' + CHAR + '; known: ' + Object.keys(CHAR_SLOTS).join(', ')); process.exit(2) }
const INJECT = fs.readFileSync(path.join(TOOL_DIR, 'inject.js'), 'utf8')

let c
const r1 = (v) => Math.round(v * 10) / 10
const E = (expr) => c.ev(expr)
const metrics = async () => E('window.__h.metrics()')   // [scrollTop, scrollHeight, clientHeight, hdrHidden, mounted]

async function fresh() {
  await phoneMode(c); await openChat(c, CHAR_SLOTS[CHAR]); await E(INJECT)
  await sleep(500)
  await idle()
}
async function idle(ms = 700) {
  let last = '', since = Date.now()
  for (let i = 0; i < 80; i++) {
    const v = JSON.stringify(await metrics()); if (v !== last) { last = v; since = Date.now() }
    if (Date.now() - since >= ms) return
    await sleep(80)
  }
}
// Finger drag with a hold before release (zero release velocity, so no momentum). dy > 0: finger down = older content.
async function drag(x, y0, dy, { stepPx = 40, dt = 16, hold = 120, single = false } = {}) {
  const n = single ? 1 : Math.max(1, Math.round(Math.abs(dy) / stepPx)); const s = dy / n
  await c.touch('touchStart', [[x, y0]])
  for (let i = 1; i <= n; i++) { await c.touch('touchMove', [[x, y0 + s * i]]); await sleep(dt) }
  await sleep(hold); await c.touch('touchEnd', [])
}
async function toBottom() {
  for (let i = 0; i < 20; i++) {
    const [st, sh, ch] = await metrics(); const rem = sh - ch - st
    if (rem < 2) return
    await drag(200, 630, -Math.min(520, rem + 10)); await idle(300)
  }
}
async function olderUntil(stTarget) {
  for (let i = 0; i < 40; i++) {
    const [st] = await metrics(); const need = st - stTarget
    if (need <= 12) return
    await drag(200, 80, Math.min(540, need + 8)); await idle(300)
  }
}
async function rowTo(idx, y) { // scroll (finger drags) until the row's top is near y
  for (let i = 0; i < 40; i++) {
    const t = await E(`window.__h.rowTop(${idx})`); if (t === null) throw new Error('row not mounted ' + idx)
    const need = y - t; if (Math.abs(need) <= 20) return t
    const dy = Math.max(-520, Math.min(520, need))
    await drag(200, dy > 0 ? 80 : 630, dy); await idle(300)
  }
  throw new Error('rowTo did not settle')
}
const mark = async () => { await E('window.__h.reset();1') }
function hdrEvents(log) { return log.filter(x => x[1] === 'HDR') }
function resample(frames, spanMs = 3000, stepMs = 100) {
  const out = []
  for (let t = 0; t <= spanMs; t += stepMs) { const f = [...frames].reverse().find(x => x.t <= t); if (f) out.push({ at: t, ...f }) }
  return out
}
function dumpFrames(tag, d, y0) { try { fs.writeFileSync(path.join(OUT, 'frames-' + tag + '.json'), JSON.stringify({ y0, frames: d.frames.map(x => [x.t, x.st, x.max, x.target, x.te, x.ste, x.n]), jsw: d.log.filter(x => x[1] === 'JSW') })) } catch (e) { console.log('dump failed ' + e) } }
async function collect() { return JSON.parse(await E('JSON.stringify({frames:window.__h.frames,log:window.__h.log,raw:window.__h.raw})')) }
const A = (id, desc, pass, observed, expected) => ({ id, desc, pass: !!pass, observed, expected })

async function stepFlow(idx, label) { // pager tap on row idx (touch)
  const p = await E(`window.__h.altBtn(${idx}, ${JSON.stringify(label)})`); if (!p) throw new Error('no pager button ' + label + ' on ' + idx)
  if (p[1] < 0 || p[1] > 735) { console.log('FALLBACK js click (pager outside the viewport) idx=' + idx + ' ' + label); await E(`(()=>{const m=document.querySelector('[data-part=chat-message][data-chat-index=\"${idx}\"]');const b=m.querySelector('[data-part=chat-message-alts] button[aria-label=\"${label}\"]');b.click();return 1})()`); return }
  await c.tap(p[0], p[1])
}

async function flingTouch(dir, dist = 480) { // quick finger swipe released with velocity: Chrome continues with momentum (Input.synthesizeScrollGesture did not scroll in this headful setup)
  const y0 = dir > 0 ? 100 : 620, n = Math.max(2, Math.round(dist / 60)), s = (dir > 0 ? 1 : -1) * dist / n
  await c.touch('touchStart', [[200, y0]]); for (let i = 1; i <= n; i++) { await c.touch('touchMove', [[200, y0 + s * i]]); await sleep(8) } await c.touch('touchEnd', [])
}
const ROW = Number(process.env.HARNESS_ROW || 49)
const ALTFIRST = process.env.HARNESS_ALTFIRST === 'next'
async function prepRow() { if (ROW !== 49) await loadToTop() }
const scenarios = {}

scenarios.H1 = async () => { // S1: load older with the header hidden
  let tries = 0, pre
  for (; tries < 3; tries++) {
    await fresh(); await toBottom(); await olderUntil(180)
    pre = { m: await metrics(), first: JSON.parse(await E('JSON.stringify(window.__h.frames.at(-1)||null)')) }
    if (pre.m[0] > 100 && pre.m[0] < 330) break
  }
  const anchorIdx = await E('window.__h.firstVisible()'); await E(`window.__h.setAnchor(${anchorIdx})`)
  const first0 = await E('window.__h.frames.at(-1).first')
  const hiddenBefore = pre.m[3]
  await mark()
  await c.touch('touchStart', [[200, 150]]); await c.touch('touchMove', [[200, 290]]); await sleep(120); await c.touch('touchEnd', [])
  await sleep(3000)
  const d = await collect(); const f = d.frames
  const loadFrame = f.find(x => x.first < first0)
  const ref = loadFrame || f[0]
  const post = f.filter(x => x.t >= ref.t && x.anchor !== null)
  const drift = post.length ? Math.max(...post.map(x => Math.abs(x.anchor - post[0].anchor))) : null
  const cleared = hdrEvents(d.log).filter(x => x[2] === 'data-hidden=cleared').length
  const hostTops = [...new Set(f.map(x => x.hostTop))], trTops = [...new Set(f.map(x => x.trTop))]
  const hdrTops = [...new Set(f.map(x => x.hdrTop))]
  return {
    notes: { anchorIdx, tries: tries + 1, preMetrics: pre.m, firstMountedBefore: first0, loadFrameFound: !!loadFrame, anchorFirst: post[0]?.anchor, anchorLast: post.at(-1)?.anchor, hostTops, hdrTops, trTops, hdrShownFrames: f.filter(x => x.hdrHidden === 0).length, headerTimeline: hdrEvents(d.log) },
    assertions: [
      A('H1.pre', 'precondition: header hidden before the load', hiddenBefore === 1, hiddenBefore, 1),
      A('H1.load', 'precondition: the drag triggered a load older (oldest mounted index decreased)', !!loadFrame, loadFrame ? { first: loadFrame.first } : 'no load', 'load'),
      A('H1.hdr', 'header stays hidden: no data-hidden cleared in 3 s', cleared === 0 && f.every(x => x.hdrHidden === 1 || x.t < 0), { cleared, hdrTops }, 0),
      A('H1.anchor', 'anchor row on-screen top moves <= 2 px from the load frame over 3 s', drift !== null && drift <= 2, drift, '<=2'),
      A('H1.tr', 'transcript top constant', trTops.length === 1, trTops, 'one value')
    ],
    samples: resample(f)
  }
}

async function h2(label) { // S2: step at the bottom with the header hidden
  const other = label === '다음 답변' ? '이전 답변' : '다음 답변'
  // setup (not measured): bring the newest reply to the state that makes `label` a real transition
  await fresh(); const ni = await E('window.__h.newestIdx()'); const al = await E(`window.__h.altLabel(${ni})`)
  const want = label === '다음 답변' ? /(\d)\/(\d)/ : /(\d)\/(\d)/
  const m = al && al.match(want), cur = m ? Number(m[1]) : 0, tot = m ? Number(m[2]) : 0
  if (label === '다음 답변' && cur === tot) { await stepFlow(ni, other); await sleep(2500); await fresh() }
  if (label === '이전 답변' && cur === 1) { await stepFlow(ni, other); await sleep(2500); await fresh() }
  await toBottom(); await idle()
  if (process.env.HARNESS_H2HIDE) { await drag(200, 80, 40); await idle(900); await E("(()=>{const t=document.querySelector('[data-part=chat-transcript]'); t.scrollTop = t.scrollHeight; return 1})()"); await idle(900) }
  const pre = await metrics(); const preLabel = await E(`window.__h.altLabel(${ni})`)
  await mark()
  await stepFlow(ni, label); await sleep(3000)
  const d = await collect(), f = d.frames
  const dev = f.map(x => r1(x.st - x.max))
  const worst = Math.max(...dev.map(Math.abs)); const under = f.filter(x => x.newestBottom > x.compTop + 2).length
  const postLabel = await E(`window.__h.altLabel(${ni})`)
  return {
    notes: { newestIdx: ni, labelBefore: preLabel, labelAfter: postLabel, preMetrics: pre, finalScrollTopMinusMax: dev.at(-1), maxMinusScrollTopSamples: dev, headerTimeline: hdrEvents(d.log), jsWrites: d.log.filter(x => x[1] === 'JSW') },
    assertions: [
      A('H2.pre', 'precondition: at the bottom with the header hidden', pre[2] > 0 && Math.abs(pre[1] - pre[2] - pre[0]) <= 2 && pre[3] === 1, { st: pre[0], max: pre[1] - pre[2], hidden: pre[3] }, 'bottom+hidden'),
      A('H2.step', 'the pager step happened (label changed)', preLabel !== postLabel, [preLabel, postLabel], 'changed'),
      A('H2.bottom', 'scrollTop equals max +-2 at every frame for 3 s', worst <= 2, { worst, final: dev.at(-1) }, '<=2'),
      A('H2.jsw', 'no JS scrollTop write attributed to the follower (setter stack contains bottomAnchor)', d.log.filter(x => x[1] === 'JSW' && /ottomAnchor/.test(x.join(' '))).length === 0, d.log.filter(x => x[1] === 'JSW' && /ottomAnchor/.test(x.join(' '))).map(x => x.slice(0, 5).join(' ')), 0),
      A('H2.scr', 'every logged scroll event reads >= max - 2', d.log.filter(x => x[1] === 'SCR').every(x => { const v = Object.fromEntries(x.slice(2).map(s => s.split('='))); return Number(v.top) >= Number(v.h) - Number(v.c) - 2 }), d.log.filter(x => x[1] === 'SCR').map(x => x.slice(2, 5).join(' ')).slice(0, 12), '>= max-2'),
      A('H2.visible', 'newest row bottom stays above the composer top (+2)', under === 0, { framesUnder: under }, 0)
    ],
    samples: resample(f)
  }
}
scenarios.H2 = async () => { const next = await h2('다음 답변'); const prev = await h2('이전 답변'); return { notes: { next: next.notes, prev: prev.notes }, assertions: [...next.assertions.map(a => ({ ...a, id: a.id + '.next' })), ...prev.assertions.map(a => ({ ...a, id: a.id + '.prev' }))], samples: { next: next.samples, prev: prev.samples } } }

async function midStep(kind) { // S3 (pager) / S8 (swipe): step row 49 mid-chat
  const idx = ROW
  await fresh(); await prepRow(); await toBottom(); await rowTo(idx, 300)
  const y0 = await E(`window.__h.rowTop(${idx})`); await E(`window.__h.setTarget(${idx})`)
  const label0 = await E(`window.__h.altLabel(${idx})`); const pre = await metrics()
  const first0 = await E('window.__h.frames.at(-1).first')
  await mark()
  if (kind === 'pager') await stepFlow(idx, '다음 답변')
  else { const b = await E(`window.__h.body(${idx})`); const y = b[1] + Math.min(b[3] / 2, 40); await swipeH(y, process.env.HARNESS_SWIPE || 'left') }
  await sleep(3000)
  const d = await collect(), f = d.frames; dumpFrames('midstep-' + kind, d, y0)
  const label1 = await E(`window.__h.altLabel(${idx})`)
  const tops = f.map(x => x.target).filter(x => x !== null)
  const moved = tops.length ? Math.max(...tops.map(x => Math.abs(x - y0))) : null
  const firstMin = Math.min(...f.map(x => x.first))
  // restore the original branch so the scenario is repeatable (not measured)
  if (label1 !== label0) { await E('window.__h.rec=false;1'); try { await revert49(); } catch { /* ignore */ } }
  return {
    notes: { deviantFrames: f.filter(x => x.target !== null && Math.abs(x.target - y0) > 2).slice(0, 14).map(x => [x.t, x.st, x.max, x.target, x.n]), jsw: d.log.filter(x => x[1] === 'JSW').slice(0, 8).map(x => x.slice(0, 6).join(' ')), kind, row: idx, labelBefore: label0, labelAfter: label1, rowTopBefore: r1(y0), rowTopTimeline: tops.filter((_, i) => i % 6 === 0), mountedFirstBefore: first0, mountedFirstMin: firstMin, preMetrics: pre, finalMetrics: await metrics().catch(() => null), headerTimeline: hdrEvents(d.log) },
    assertions: [
      A(kind === 'pager' ? 'H3.step' : 'H8.step', 'the step happened (label changed)', label0 !== label1, [label0, label1], 'changed'),
      A(kind === 'pager' ? 'H3.top' : 'H8.top', 'stepped row on-screen top moves <= 2 px over 3 s', moved !== null && moved <= 2, moved === null ? 'row unmounted' : r1(moved), '<=2'),
      A(kind === 'pager' ? 'H3.window' : 'H8.window', 'no row older than the previous oldest mounted index mounts', firstMin >= first0, { before: first0, min: firstMin }, '>= before')
    ],
    samples: resample(f)
  }
}
async function swipeH(y, dir) { // horizontal swipe: left = finger moves left
  const [x0, x1] = dir === 'left' ? [320, 60] : [60, 320]
  await c.touch('touchStart', [[x0, y]])
  for (let i = 1; i <= 12; i++) { await c.touch('touchMove', [[x0 + (x1 - x0) * i / 12, y]]); await sleep(16) }
  await c.touch('touchEnd', [])
}
scenarios.H3 = () => midStep('pager')
scenarios.H8 = async () => {
  // find the swipe direction that steps (next); report both attempts
  const r = await midStep('swipe'); return r
}

scenarios.H7 = async () => { // S7: a header toggle leaves the transcript rect and scrollTop unchanged
  await fresh(); await toBottom(); await olderUntil(1500)
  await drag(200, 200, -80); await idle(900) // newer -> header shown
  const shown = JSON.parse(await E('JSON.stringify(window.__h.frames.at(-1))')); const mS = await metrics()
  await mark()
  await drag(200, 100, 80); await sleep(1500) // older 24+ -> header hidden
  const d = await collect(), f = d.frames, last = f.at(-1)
  const trTops = [...new Set(f.map(x => x.trTop))], trHs = [...new Set(f.map(x => x.trH))]
  return {
    notes: { shown: { hdrHidden: shown.hdrHidden, trTop: shown.trTop, trH: shown.trH, hostTop: shown.hostTop, hostH: shown.hostH, st: shown.st }, hidden: { hdrHidden: last.hdrHidden, trTop: last.trTop, trH: last.trH, hostTop: last.hostTop, hostH: last.hostH, st: last.st }, trTops, trHs, headerTimeline: hdrEvents(d.log), jsWrites: d.log.filter(x => x[1] === 'JSW') },
    assertions: [
      A('H7.pre', 'precondition: header shown before, hidden after', shown.hdrHidden === 0 && last.hdrHidden === 1, [shown.hdrHidden, last.hdrHidden], '[0,1]'),
      A('H7.top', 'transcript top identical shown vs hidden', shown.trTop === last.trTop && trTops.length === 1, { shown: shown.trTop, hidden: last.trTop, seen: trTops }, 'equal'),
      A('H7.h', 'transcript height identical shown vs hidden', shown.trH === last.trH && trHs.length === 1, { shown: shown.trH, hidden: last.trH, seen: trHs }, 'equal')
    ],
    samples: resample(f, 1500)
  }
}

// T-A1: record raw event sequences (desktop-emulated, not Note 9)
scenarios['T-A1'] = async () => {
  const meta = { source: 'desktop-emulated', note: 'Recorded in desktop Chrome 156 with Emulation.setDeviceMetricsOverride 360x740 DPR 2.8125 mobile + touch emulation, events injected through CDP Input.dispatchTouchEvent / Input.synthesizeScrollGesture / Input.dispatchMouseEvent. NOT Note 9 / Android WebView recordings.', base: BASE, recordedAt: new Date().toISOString() }
  const saved = []
  const fixtureDir = path.join(OUT, 'fixtures'); fs.mkdirSync(fixtureDir, { recursive: true })
  const save = (name, extra, d) => { const o = { ...meta, name, ...extra, events: d.raw }; fs.writeFileSync(path.join(fixtureDir, name + '.json'), JSON.stringify(o, null, 1)); saved.push({ name, events: d.raw.length, types: [...new Set(d.raw.map(e => e.type))] }) }
  const run = async (name, extra, fn, waitMs = 1200) => { await idle(300); await E('window.__h.rec=true;window.__h.reset();1'); await fn(); await sleep(waitMs); const d = await collect(); await E('window.__h.rec=false;1'); save(name, { ...extra, scroll: 'top ' + (await metrics())[0] }, d); }
  await fresh(); await toBottom(); await olderUntil(1500)
  const bodyIdx = await E('window.__h.firstVisible()')
  const b = await E(`window.__h.body(${bodyIdx + 1})`) || await E(`window.__h.body(${bodyIdx})`)
  const by = Math.min(Math.max(b[1] + 20, 120), 560)
  await run('tap-body', { gesture: 'tap on a message body', x: 200, y: by }, async () => { await c.tap(200, by) })
  await run('slow-drag-older', { gesture: 'finger down 160 px, 4 px steps every 16 ms, hold 120 ms, release (no fling)' }, async () => { await drag(200, 150, 160, { stepPx: 4, dt: 16, hold: 120 }) })
  await run('slow-drag-newer', { gesture: 'finger up 160 px, 4 px steps every 16 ms, hold 120 ms, release' }, async () => { await drag(200, 400, -160, { stepPx: 4, dt: 16, hold: 120 }) })
  await run('drag-short-under-slop', { gesture: 'finger down 6 px (under the 8 px slop), release' }, async () => { await drag(200, 300, 6, { stepPx: 6, dt: 16, hold: 60 }) })
  await run('fling-older', { gesture: 'finger down 480 px in 8 ms steps of 60 px, released with velocity (momentum scroll); Input.synthesizeScrollGesture produced no scroll here' }, async () => { await flingTouch(1) }, 2500)
  await run('fling-newer', { gesture: 'finger up 480 px fast swipe, released with velocity' }, async () => { await flingTouch(-1) }, 2500)
  await run('swipe-left-horizontal', { gesture: 'horizontal finger swipe left 260 px at message body, 12 moves' }, async () => { await swipeH(by, 'left') }, 1500)
  await run('swipe-right-horizontal', { gesture: 'horizontal finger swipe right 260 px at message body' }, async () => { await swipeH(by, 'right') }, 1500)
  await run('two-finger-pinch', { gesture: 'two touch points moving apart' }, async () => {
    await c.touch('touchStart', [[150, 300], [210, 300]]); for (let i = 1; i <= 8; i++) { await c.touch('touchMove', [[150 - i * 8, 300], [210 + i * 8, 300]]); await sleep(16) } await c.touch('touchEnd', [])
  }, 800)
  // pager tap on row 49 (restore afterwards)
  await toBottom(); await rowTo(49, 300)
  await run('pager-tap-next', { gesture: 'tap on the next-answer pager button of a mid-chat row' }, async () => { await stepFlow(49, '다음 답변') }, 2500)
  await rowTo(49, 300).catch(() => {}); await E('window.__h.rec=false;1'); await stepFlow(49, '이전 답변'); await sleep(2500)
  // edge pulls: newer pull at the bottom, older pull at the oldest end (after loading everything)
  await toBottom()
  await run('edge-pull-newer-at-bottom', { gesture: 'finger up 150 px at the bottom (cannot move)' }, async () => { await drag(200, 500, -150, { stepPx: 10, dt: 16, hold: 100 }) })
  for (let i = 0; i < 30; i++) { const [st, , , , n] = await metrics(); const more = await E(`!!document.querySelector('[data-part=chat-load-more]')`); if (st < 1 && !more) break; await drag(200, 80, 540); await idle(400) }
  const top = await metrics()
  await run('edge-pull-older-at-top', { gesture: 'finger down 150 px at scrollTop 0 after loading all older rows', metricsBefore: top }, async () => { await drag(200, 200, 150, { stepPx: 10, dt: 16, hold: 100 }) })
  // wheel (desktop emulation, mouse)
  await desktopMode(c); await sleep(900)
  const tr = JSON.parse(await E(`JSON.stringify((r=>[r.x+r.width/2,r.y+r.height/2])(document.querySelector('[data-part=chat-transcript]').getBoundingClientRect()))`))
  const wh = (dx, dy, mods = 0, mode = 'pixel') => c.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: tr[0], y: tr[1], deltaX: dx, deltaY: dy, modifiers: mods })
  await run('wheel-vertical-older-newer', { gesture: 'mouseWheel deltaY -120 x3 (older) then +120 x3 (newer), desktop emulation' }, async () => { for (let i = 0; i < 3; i++) { await wh(0, -120); await sleep(40) } for (let i = 0; i < 3; i++) { await wh(0, 120); await sleep(40) } })
  await run('wheel-horizontal', { gesture: 'mouseWheel deltaX +60 / -60' }, async () => { await wh(60, 0); await sleep(60); await wh(-60, 0) })
  await run('wheel-shift', { gesture: 'mouseWheel deltaY 120 with Shift (modifiers=8)' }, async () => { await wh(0, 120, 8); await sleep(60); await wh(0, -120, 8) })
  await run('wheel-ctrl', { gesture: 'mouseWheel deltaY 120 with Ctrl (modifiers=2)' }, async () => { await wh(0, 120, 2); await sleep(60); await wh(0, -120, 2) })
  const key = async (k, code, vk, mods = 0) => { const base = { key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }; await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base }); await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base }) }
  await E(`document.querySelector('[data-part=chat-transcript]').focus();1`)
  await run('keys-page-arrow', { gesture: 'PageUp, PageDown, ArrowUp, ArrowDown on the transcript host (tabindex focus attempted)' }, async () => { await key('PageUp', 'PageUp', 33); await sleep(200); await key('PageDown', 'PageDown', 34); await sleep(200); await key('ArrowUp', 'ArrowUp', 38); await key('ArrowDown', 'ArrowDown', 40) })
  await phoneMode(c)
  return { notes: { fixtures: saved }, assertions: [A('T-A1.rec', 'every fixture recorded at least one input event', saved.every(s => s.events > 0), saved.map(s => s.name + ':' + s.events), 'all > 0')], samples: [] }
}

// ---- r2 scenarios (plan r2 Stage E) ----
async function setStore(idx) { // ScrollToMessage through the app's own store (the one jump-to-message entry that has no stable UI path in the shell)
  return E(`import('/src/ts/stores.svelte.ts').then(m => { m.ScrollToMessageStore.value = ${idx}; return true })`)
}
async function revert49() { // put row ROW back on its first alternative (not measured)
  for (let i = 0; i < 3; i++) { const l = await E(`window.__h.altLabel(${ROW})`); if (l && /1\/3/.test(l)) return; try { if ((await E('window.__h.newestIdx()')) === ROW) await toBottom(); else await rowTo(ROW, 300); await stepFlow(ROW, '이전 답변'); await sleep(2200) } catch { /* ignore */ } }
}
async function h12(gap) { // S14: rapid double pager tap mid-chat
  await fresh(); await prepRow(); await toBottom(); await rowTo(ROW, 300); await revert49()
  const y0 = await E(`window.__h.rowTop(${ROW})`); await E(`window.__h.setTarget(${ROW})`)
  const p = await E(`window.__h.altBtn(${ROW}, '다음 답변')`); const l0 = await E(`window.__h.altLabel(${ROW})`); const first0 = await E('window.__h.frames.at(-1).first')
  await mark()
  await c.tap(p[0], p[1]); await sleep(gap); const p2 = (await E(`window.__h.altBtn(${ROW}, '다음 답변')`)) || p; if (p2[1] < 0 || p2[1] > 735) await stepFlow(ROW, '다음 답변'); else await c.tap(p2[0], p2[1])
  await sleep(3000)
  const d = await collect(), f = d.frames, tops = f.map(x => x.target).filter(x => x !== null); dumpFrames('h12-' + gap, d, y0)
  const moved = tops.length ? Math.max(...tops.map(x => Math.abs(x - y0))) : null
  const l1 = await E(`window.__h.altLabel(${ROW})`), firstMin = Math.min(...f.map(x => x.first))
  await revert49()
  return { notes: { deviantFrames: f.filter(x => x.target !== null && Math.abs(x.target - y0) > 2).slice(0, 14).map(x => [x.t, x.st, x.max, x.target, x.n]), gap, rowTopBefore: r1(y0), labelBefore: l0, labelAfter: l1, mountedFirstBefore: first0, mountedFirstMin: firstMin, jsWrites: d.log.filter(x => x[1] === 'JSW').length, rowTopSamples: tops.filter((_, i) => i % 6 === 0) },
    assertions: [A(`H12.${gap}.step`, 'both taps stepped (label advanced by 2 or hit the end)', l0 !== l1, [l0, l1], 'changed'), A(`H12.${gap}.top`, 'stepped row on-screen top <= 2 px over 3 s', moved !== null && moved <= 2, moved === null ? 'row unmounted' : r1(moved), '<=2')], samples: resample(f) }
}
scenarios.H12 = async () => { const a = await h12(80), b = await h12(250); return { notes: { a: a.notes, b: b.notes }, assertions: [...a.assertions, ...b.assertions], samples: { gap80: a.samples, gap250: b.samples } } }

scenarios.H13 = async () => { // S11: hit testing of the (hidden) overlay header
  await fresh(); await toBottom(); await olderUntil(1500)
  await drag(200, 200, -80); await idle(900) // newer -> header shown
  const shown = await E('window.__h.metrics()')
  const hitShown = await E('window.__h.hitProbe(180, 24, 100)')
  const probe = E('window.__h.hitProbe(180, 24, 900)') // runs across the hide transition
  await drag(200, 100, 80); const trace = await probe; await idle(900)
  const hidden = await E('window.__h.metrics()')
  const hitRest = await E('window.__h.hitProbe(180, 24, 100)')
  const st0 = hidden[0]
  await drag(180, 24, 120); await idle(600) // touch drag starting inside the header strip
  const st1 = (await E('window.__h.metrics()'))[0]
  const bad = trace.filter(x => x[1] === 'header' && x[2] === 1)
  return { notes: { shown, hidden, hitShown: hitShown.slice(0, 3), hitRest: hitRest.slice(0, 3), traceHeaderFramesWhileHidden: bad.length, traceFrames: trace.length, trace: trace.filter((_, i) => i % 5 === 0), scrollTopBefore: st0, scrollTopAfter: st1 },
    assertions: [A('H13.pre', 'precondition: header shown, then hidden', shown[3] === 0 && hidden[3] === 1, [shown[3], hidden[3]], '[0,1]'),
      A('H13.shown', 'header shown: the point returns a header descendant', hitShown.every(x => x[1] === 'header'), hitShown.slice(0, 3), 'header'),
      A('H13.rest', 'header hidden at rest: the point returns a transcript descendant', hitRest.every(x => x[1] === 'transcript'), hitRest.slice(0, 3), 'transcript'),
      A('H13.transition', 'during the hide transition no frame with data-hidden set returns a header descendant', bad.length === 0, bad.length, 0),
      A('H13.drag', 'a touch drag starting at y=24 moves the transcript (scrollTop decreased >= 40)', st0 - st1 >= 40, st0 - st1, '>=40')], samples: [] }
}

scenarios.H14 = async () => { // S12: ScrollToMessage lands below a shown header, at the top when hidden
  const out = []
  async function once(label, prepare) {
    await fresh(); await toBottom(); await olderUntil(1500); await prepare(); await idle(900)
    const m0 = await E('window.__h.metrics()'); const hb = await E(`document.querySelector('[data-part=chat-header]').getBoundingClientRect().bottom`)
    const trTop = await E(`document.querySelector('[data-part=chat-transcript]').getBoundingClientRect().top`)
    await setStore(60); await sleep(1200)
    const rt = await E('window.__h.rowTop(57)'); const m1 = await E('window.__h.metrics()')
    return { label, hdrHidden: m0[3], hdrBottom: r1(hb), trTop: r1(trTop), targetTop: rt === null ? null : r1(rt), hdrHiddenAfter: m1[3], before: m0, after: m1, ids: await E("[...document.querySelectorAll('[data-part=chat-message]')].map(m => m.dataset.chatIndex).join(',')") }
  }
  const shown = await once('shown', async () => { await drag(200, 200, -80) })
  const hidden = await once('hidden', async () => { await drag(200, 100, 80) })
  const focus = await once('hidden-then-focus', async () => { await drag(200, 100, 80); await idle(800); await E(`document.querySelector('[data-part=chat-header-back]').focus();1`) })
  return { notes: { shown, hidden, focus }, assertions: [
    A('H14.shown', 'header shown: target row top >= header bottom', shown.hdrHidden === 0 && shown.targetTop !== null && shown.targetTop >= shown.hdrBottom - 1, shown, '>= hdrBottom'),
    A('H14.hidden', 'header hidden: target row at the transcript top (<= 2 px)', hidden.hdrHidden === 1 && hidden.targetTop !== null && Math.abs(hidden.targetTop - hidden.trTop) <= 2, hidden, 'top'),
    A('H14.focus', 'header shown by focus-within while the flag is set: target row top >= header bottom', focus.targetTop !== null && focus.targetTop >= focus.hdrBottom - 1, focus, '>= hdrBottom')], samples: [] }
}

const FIRST_NODE = `document.querySelector('[data-part=chat-message][data-chat-index="-1"]')`
async function loadToTop() { await toBottom(); await olderUntil(0); for (let i = 0; i < 25; i++) { const [st] = await metrics(); if (st < 1 && !(await E(`!!document.querySelector('[data-part=chat-load-more]')`))) break; await drag(200, 80, 540); await idle(400) } }
scenarios.H15 = async () => { // S15: first-message step with the first message partly above the viewport (profile fixture: character H15 Alt Greetings, first message + 3 alternates)
  await fresh(); await loadToTop()
  const has = await E('window.__h.altLabel(-1)')
  if (!has) return { notes: { reason: 'N/A: the opened character has no alternate first messages, so row -1 has no pager (use --char "H15 Alt Greetings")' }, assertions: [], skipped: true, samples: [] }
  const y0 = await rowTo(-1, -40); await E('window.__h.setTarget(-1)'); await E(`window.__keepFirst = ${FIRST_NODE}; 1`)
  const label0 = await E('window.__h.altLabel(-1)'), txt0 = await E(`${FIRST_NODE}.innerText.slice(0, 60)`), pre = await metrics()
  await mark(); await stepFlow(-1, '다음 답변'); await sleep(3000)
  const d = await collect(), tops = d.frames.map(x => x.target).filter(x => x !== null), moved = tops.length ? Math.max(...tops.map(x => Math.abs(x - y0))) : null
  const label1 = await E('window.__h.altLabel(-1)'), txt1 = await E(`${FIRST_NODE}.innerText.slice(0, 60)`)
  const sameNode = await E(`window.__keepFirst === ${FIRST_NODE}`)
  try { await stepFlow(-1, '이전 답변'); await sleep(1500) } catch { /* restore 1/4, not measured */ }
  return { notes: { rowTopBefore: r1(y0), labelBefore: label0, labelAfter: label1, textBefore: txt0, textAfter: txt1, sameNode, preMetrics: pre, finalMetrics: await metrics().catch(() => null), jswrites: d.log.filter(x => x[1] === 'JSW').map(x => x.slice(0, 5).join(' ')) },
    assertions: [A('H15.step', 'the first-message step happened (label changed)', label0 !== label1, [label0, label1], 'changed'),
      A('H15.top', 'first message on-screen top moves <= 2 px over 3 s', moved !== null && moved <= 2, moved === null ? 'row unmounted' : r1(moved), '<=2')], samples: resample(d.frames) }
}
// H15b (plan Stage E): fully loaded short chat, not following. Mid-chat step to a shorter sibling and back to the longer one, then a first-message step: the first message stays mounted as the same node and the stepped row stays within 2 px.
scenarios.H15b = async () => {
  await fresh(); await loadToTop()
  const mid = Number(process.env.HARNESS_MIDROW || 13)
  if (!(await E('window.__h.altLabel(-1)')) || !(await E(`window.__h.altLabel(${mid})`))) return { notes: { reason: `N/A: needs row -1 with a pager and row ${mid} with alternatives (profile fixture H15 Alt Greetings built per result.md)` }, assertions: [], skipped: true, samples: [] }
  await E(`window.__keepFirst = ${FIRST_NODE}; 1`)
  const notes = { steps: [] }, assertions = []
  async function one(tag, idx, label, y) {
    if (y !== null) await rowTo(idx, y); const y0 = await E(`window.__h.rowTop(${idx})`); await E(`window.__h.setTarget(${idx})`)
    const l0 = await E(`window.__h.altLabel(${idx})`), keep = await E(`window.__keepFirst.isConnected`)
    await mark(); await stepFlow(idx, label); await sleep(2500)
    const d = await collect(); dumpFrames('h15b-' + tag, d, y0); const tops = d.frames.map(x => x.target).filter(x => x !== null), moved = tops.length ? Math.max(...tops.map(x => Math.abs(x - y0))) : null
    const l1 = await E(`window.__h.altLabel(${idx})`), same = await E(`window.__keepFirst === ${FIRST_NODE}`), rows = await E(`document.querySelectorAll('[data-part=chat-message]').length`)
    notes.steps.push({ deviantFrames: d.frames.filter(x => x.target !== null && Math.abs(x.target - y0) > 2).slice(0, 14).map(x => [x.t, x.st, x.max, x.target, x.n]), jsw: d.log.filter(x => x[1] === 'JSW').slice(0, 8).map(x => x.slice(0, 6).join(' ')), tag, idx, label, labelBefore: l0, labelAfter: l1, rowTopBefore: r1(y0), maxDeviation: moved === null ? null : r1(moved), firstNodeSame: same, mountedRows: rows })
    assertions.push(A(`H15b.${tag}.step`, 'the step happened (label changed)', l0 !== l1, [l0, l1], 'changed'),
      A(`H15b.${tag}.top`, 'stepped row top moves <= 2 px over 2.5 s', moved !== null && moved <= 2, moved === null ? 'row unmounted' : r1(moved), '<=2'),
      A(`H15b.${tag}.first`, 'first message still mounted as the same node', same === true, same, true))
  }
  await one('shorter', mid, ALTFIRST ? '다음 답변' : '이전 답변', 300)   // 3/3 -> 2/3: the chain loses its tail
  await one('longer', mid, ALTFIRST ? '이전 답변' : '다음 답변', null)   // 2/3 -> 3/3: the tail returns (the row is last while the chain is short, so no repositioning)
  await one('firstmsg', -1, '다음 답변', -40)   // first-message step
  try { await stepFlow(-1, '이전 답변'); await sleep(1500) } catch { /* restore 1/4, not measured */ }
  return { notes, assertions, samples: [] }
}

async function h16(variant) { // desktop-emulated; the plan's H16 is a Note 9 scenario (run against a forwarded device CDP port with HARNESS_CDP)
  await fresh(); await toBottom(); await olderUntil(1500)
  if (variant === 'noanchor') await E(`(()=>{const s=document.createElement('style');s.id='__h16';s.textContent='[data-part=chat-transcript]{overflow-anchor:none}';document.head.appendChild(s);return 1})()`)
  const a = await E('window.__h.firstVisible()'); await E(`window.__h.setAnchor(${a})`); const first0 = await E('window.__h.frames.at(-1).first')
  await mark(); for (let k = 0; k < 4; k++) { await flingTouch(1); await sleep(450) } await sleep(2500)
  const d = await collect(), f = d.frames
  const li = f.findIndex(x => x.first < first0)
  let jump = null, momentum = null
  if (li > 6) { const dl = f.slice(li - 6, li).map((x, i, arr) => i ? (x.anchor - arr[i - 1].anchor) : 0).slice(1).sort((p, q) => p - q), med = dl[Math.floor(dl.length / 2)]; jump = r1((f[li].anchor - f[li - 1].anchor) - med); momentum = r1(f.at(-1).t - f[li].t); const moving = f.slice(li).filter((x, i, arr) => i && x.st !== arr[i - 1].st); momentum = r1(moving.length ? moving.at(-1).t - f[li].t : 0) }
  return { notes: { variant, label: 'DESKTOP-EMULATED diagnostic (plan: Note 9)', loadFrame: li, jumpVsMedianPx: jump, scrollingMsAfterLoad: momentum, firstBefore: first0, firstAfter: f.at(-1).first, scrollEvents: d.log.filter(x => x[1] === 'SCR').length, jswrites: d.log.filter(x => x[1] === 'JSW').map(x => x.slice(0, 5).join(' ')) }, assertions: [A(`H16.${variant}.load`, 'the fling triggered a load older', li >= 0, li, '>=0'), A(`H16.${variant}.anchor`, 'anchor jump at the load frame <= 2 px (vs the preceding median frame delta)', jump !== null && Math.abs(jump) <= 2, jump, '<=2'), A(`H16.${variant}.momentum`, 'scrolling continues >= 300 ms after the load frame', momentum !== null && momentum >= 300, momentum, '>=300')], samples: resample(f) }
}
scenarios.H16 = async () => { const a = await h16('baseline'), b = await h16('noanchor'); return { notes: { baseline: a.notes, noanchor: b.notes }, assertions: [...a.assertions, ...b.assertions], samples: { baseline: a.samples, noanchor: b.samples } } }
scenarios.RESET = async () => { await fresh(); await loadToTop(); await revert49(); for (let i = 0; i < 4; i++) { const l = await E('window.__h.altLabel(-1)'); if (l && /1\/4/.test(l)) break; await rowTo(-1, 200).catch(() => {}); await stepFlow(-1, '이전 답변'); await sleep(1500) } return { notes: { row: await E('window.__h.altLabel(' + ROW + ')'), first: await E('window.__h.altLabel(-1)') }, assertions: [], samples: [] } }
async function runOne(name) {
  const t0 = Date.now(); let res
  try { res = await scenarios[name]() } catch (e) { res = { assertions: [A(name + '.run', 'scenario ran without error', false, String(e.stack || e).slice(0, 600), 'no error')], notes: {}, samples: [] } }
  const out = { scenario: name, base: BASE, startedAt: new Date(t0).toISOString(), seconds: Math.round((Date.now() - t0) / 1000), pass: res.assertions.every(a => a.pass), ...res }
  fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(out, null, 1))
  console.log(name, out.pass ? 'PASS' : 'FAIL'); for (const a of res.assertions) console.log('  ' + (a.pass ? 'ok  ' : 'FAIL') + ' ' + a.id + ' ' + JSON.stringify(a.observed) + ' (expected ' + JSON.stringify(a.expected) + ')')
  return out.pass
}

// Validation block: every argument error exits 2 here, before the connection and before any directory is created.
const names = argv.includes('--all') ? ['H1', 'H2', 'H3', 'H7', 'H8', 'H12', 'H13', 'H14'] : [arg('--scenario')]
if (!names[0] || !scenarios[names[0]]) { console.error('usage: --scenario ' + Object.keys(scenarios).join('|') + ' | --all  [--char name] [--out dir]'); process.exit(2) }
try { OUT = outDir(arg('--out')) } catch (e) { console.error(String(e.message || e)); process.exit(2) }
c = await connect()
let ok = true
for (const n of names) ok = (await runOne(n)) && ok
process.exit(ok ? 0 : 1)

// tb.mjs - host-side client for the tbdriver companion. The device side listens on 127.0.0.1:9562; session.ps1 forwards
// TB_HOST_PORT (default 9562) to it through adbg. TB_SCREEN=WxH (default 1080x2220, the Note 9) places the gestures.
// TalkBack gestures go through the companion's dispatchGesture, so TalkBack's touch explorer sees them as finger input.
// Usage: node tb.mjs <cmd> [args]
//   ping | focus | tree [max] | find <text> | events [since] [kind] | speech [since]
//   next | prev | activate | scrolldown | scrollup | firstlast                (verified on the Note 9, Samsung VA 11.5)
//   lupleft | lupright | rightleft                                           (UNCALIBRATED shapes: see README)
//   raw <path?query>                                                         (any companion endpoint)
//   explore <x> <y> : touch exploration at a point (slow drag through it), prints the new focus and speech
//   step <gesture>  : run a gesture, wait for TalkBack to settle, print new a11y focus + new speech
const BASE = `http://127.0.0.1:${process.env.TB_HOST_PORT ?? 9562}`
const [W, H] = (process.env.TB_SCREEN ?? '1080x2220').split('x').map(Number)
const cx = W / 2, cy = H / 2
const get = async (p) => (await fetch(BASE + p)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Verified on the Note 9 (Samsung Voice Assistant 11.5): right/left swipe = next/previous item; double tap = activate the
// focused item wherever the tap lands; two-finger swipe = scroll (passed through by the touch explorer); down then up =
// jump to the last item. The L-shapes are detected as gestures but their Samsung mapping is unknown: on 2026-11-19 they
// read single characters and seemed to change the reading control, so do not use them as back or home.
const G = {
  next: `/swipe?x1=${cx - 300}&y1=${cy}&x2=${cx + 300}&y2=${cy}&ms=150`,
  prev: `/swipe?x1=${cx + 300}&y1=${cy}&x2=${cx - 300}&y2=${cy}&ms=150`,
  activate: `/taps?x=${cx}&y=${cy}&n=2&ms=40&gap=90`,
  scrolldown: `/fingers?n=2&x=${cx - 75}&y=${cy + 400}&dx=0&dy=-800&ms=400`,
  scrollup: `/fingers?n=2&x=${cx - 75}&y=${cy - 400}&dx=0&dy=800&ms=400`,
  lupleft: `/path?pts=${cx},${cy + 200}_${cx},${cy - 300}_${cx - 400},${cy - 300}&ms=400`, // up then left
  lupright: `/path?pts=${cx},${cy + 200}_${cx},${cy - 300}_${cx + 400},${cy - 300}&ms=400`, // up then right
  firstlast: `/path?pts=${cx},${cy - 300}_${cx},${cy + 300}_${cx},${cy - 300}&ms=400`, // down then up: jumped to the last item ("끝으로 이동")
  rightleft: `/path?pts=${cx - 300},${cy}_${cx + 300},${cy}_${cx - 300},${cy}&ms=400`, // right then left (uncalibrated)
}

async function settle(since, quietMs = 700, maxMs = 5000) {
  const t0 = Date.now()
  let last = since, lastChange = Date.now()
  while (Date.now() - t0 < maxMs) {
    await sleep(150)
    const r = await get(`/events?since=${last}`)
    if (r.items.length) { last = r.last; lastChange = Date.now() }
    else if (Date.now() - lastChange > quietMs) break
  }
  return last
}

const [, , cmd, ...a] = process.argv
const out = (x) => console.log(JSON.stringify(x, null, 1))
if (cmd === 'ping') out(await get('/ping'))
else if (cmd === 'focus') out(await get('/focus'))
else if (cmd === 'tree') out(await get(`/tree?max=${a[0] ?? 400}`))
else if (cmd === 'find') out(await get(`/find?text=${encodeURIComponent(a[0])}`))
else if (cmd === 'events') out(await get(`/events?since=${a[0] ?? 0}${a[1] ? `&kind=${a[1]}` : ''}`))
else if (cmd === 'speech') out((await get(`/events?since=${a[0] ?? 0}&kind=speech`)).items.map((i) => i.text))
else if (cmd === 'raw') out(await get(a[0]))
else if (cmd === 'explore') {
  // Touch exploration at (x, y): a slow 80 px drag through the point. WebView hit-tests on hover moves, which a
  // stationary injected tap never produces; native views also accept this form.
  const x = Number(a[0]), y = Number(a[1])
  const before = (await get('/ping')).last
  const r = await get(`/path?pts=${x - 40},${y}_${x + 40},${y}&ms=800`)
  const after = await settle(before)
  const ev = (await get(`/events?since=${before}`)).items.filter((i) => i.seq <= after)
  const f = await get('/focus')
  out({ explore: [x, y], dispatch: r, speech: ev.filter((i) => i.kind === 'speech').map((i) => i.text), nowFocused: f.a11y && { text: f.a11y.text, desc: f.a11y.desc, cls: f.a11y.cls, bounds: f.a11y.bounds } })
}
else if (cmd === 'step' || G[cmd] !== undefined) {
  const name = cmd === 'step' ? a[0] : cmd
  const before = (await get('/ping')).last
  const r = await get(G[name])
  const after = await settle(before)
  const ev = (await get(`/events?since=${before}`)).items.filter((i) => i.seq <= after)
  const focusEv = ev.filter((i) => i.type === 'TYPE_VIEW_ACCESSIBILITY_FOCUSED').map((i) => i.node && { text: i.node.text, desc: i.node.desc, cls: i.node.cls, bounds: i.node.bounds })
  const gestureEv = ev.filter((i) => /GESTURE|TOUCH/.test(i.type ?? '')).map((i) => i.type)
  const speech = ev.filter((i) => i.kind === 'speech').map((i) => i.text)
  const app = ev.filter((i) => i.kind === 'app')
  const focus = await get('/focus')
  out({ gesture: name, dispatch: r, gestureEvents: gestureEv, focusEvents: focusEv, speech, app, nowFocused: focus.a11y && { text: focus.a11y.text, desc: focus.a11y.desc, cls: focus.a11y.cls, bounds: focus.a11y.bounds } })
} else { console.error('unknown command'); process.exit(2) }

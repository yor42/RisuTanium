// probe.mjs - TalkBack reachability probe (lane C E10): 12 linear `next` swipes, then 3 touch-explore drags, via tbdriver.
// PASS-linear: some step focuses a node of the app package, other than the WebView container, inside the WebView's bounds.
// PASS-explore: at least 2 of 3 explore drags put accessibility focus on that kind of node under the finger. Targets for
// 'risu' are Home's 메뉴, persona chip and version text; for 'probe' (io.github.yor42.tbprobe) its first three visible
// buttons. Screen coordinates assume a 1080x2220 portrait screen (Note 9). Never runs a uiautomator dump.
// Usage: node probe.mjs <risu|probe> <out.json>   (TB_HOST_PORT as in tb.mjs)
import { writeFileSync } from 'node:fs'
const BASE = `http://127.0.0.1:${process.env.TB_HOST_PORT ?? 9562}`
const get = async (p) => (await fetch(BASE + p)).json()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const [, , app, outFile] = process.argv
const PKG = app === 'risu' ? 'io.github.yor42.risutanium' : 'io.github.yor42.tbprobe'

async function settle(since, quietMs = 700, maxMs = 5000) {
  const t0 = Date.now(); let last = since, lastChange = Date.now()
  while (Date.now() - t0 < maxMs) {
    await sleep(150)
    const r = await get(`/events?since=${last}`)
    if (r.items.length) { last = r.last; lastChange = Date.now() } else if (Date.now() - lastChange > quietMs) break
  }
  return last
}
const brief = (n) => n && { cls: n.cls, text: n.text, desc: n.desc, pkg: n.pkg, bounds: n.bounds }
// A web element: a node of the app package, not the WebView container, lying inside the outer WebView's bounds
// (so a native action-bar title does not count). The WebView bounds are read from the tree at probe start.
let WV = null
const isWeb = (n) => !!n && !!WV && n.pkg === PKG && n.cls !== 'android.webkit.WebView' && n.cls !== 'android.widget.FrameLayout'
  && n.bounds[0] >= WV[0] && n.bounds[1] >= WV[1] && n.bounds[2] <= WV[2] && n.bounds[3] <= WV[3]
const inside = (n, x, y) => !!n && n.bounds[0] <= x && x <= n.bounds[2] && n.bounds[1] <= y && y <= n.bounds[3]

async function act(path) {
  const before = (await get('/ping')).last
  const d = await get(path)
  const after = await settle(before)
  const ev = (await get(`/events?since=${before}`)).items.filter((i) => i.seq <= after)
  const f = await get('/focus')
  return {
    dispatch: d.result,
    gestureDetected: ev.some((i) => i.type === 'TYPE_GESTURE_DETECTION_START'),
    touchInteraction: ev.some((i) => i.type === 'TYPE_TOUCH_INTERACTION_START'),
    speech: ev.filter((i) => i.kind === 'speech' && i.text).map((i) => i.text),
    focus: brief(f.a11y),
  }
}

const t0 = await get('/tree?max=300')
const w0 = t0.windows.find((w) => w.type === 1 && w.nodes.some((n) => n.pkg === PKG))
WV = w0?.nodes.find((n) => n.cls === 'android.webkit.WebView')?.bounds ?? null
const res = { app, pkg: PKG, ping: await get('/ping'), webViewBounds: WV, linear: [], explore: [] }
for (let k = 1; k <= 12; k++) {
  const r = await act('/swipe?x1=240&y1=1110&x2=840&y2=1110&ms=150')
  // A step counts only if TalkBack detected the swipe: a stale web focus left by an earlier run must not pass.
  res.linear.push({ step: k, ...r, web: r.gestureDetected && isWeb(r.focus) })
}
const firstWeb = res.linear.find((s) => s.web)
res.linearPass = !!firstWeb
res.firstWeb = firstWeb ? { step: firstWeb.step, focus: firstWeb.focus, speech: firstWeb.speech } : null
res.stuckOn = firstWeb ? null : [...new Set(res.linear.map((s) => `${s.focus?.cls}|${s.focus?.text ?? ''}|${s.focus?.desc ?? ''}`))]

// The linear walk scrolls the page; two-finger swipes down (passed through by the touch explorer) bring it back to the top.
for (let k = 0; k < 4; k++) await act('/fingers?n=2&x=465&y=700&dx=0&dy=1000&ms=400')
// Touch-explore targets, located in the current tree (never by fixed points, which the scroll moves).
const t = await get('/tree?max=300')
const win = t.windows.find((w) => w.type === 1 && w.nodes.some((n) => n.pkg === PKG))
const nodes = (win?.nodes ?? []).filter((n) => n.visible && n.bounds[1] >= 63 && n.bounds[3] <= 2094)
const centre = (n, name) => n ? { name, x: Math.round((n.bounds[0] + n.bounds[2]) / 2), y: Math.round((n.bounds[1] + n.bounds[3]) / 2), node: `${n.cls}|${n.text ?? ''}|${n.desc ?? ''}` } : { name: `${name} (not on screen)`, x: null, y: null }
let targets
if (app === 'risu') {
  targets = [
    centre(nodes.find((n) => n.cls === 'android.widget.Button' && (n.desc === '메뉴' || n.text === '메뉴')), '메뉴'),
    centre(nodes.find((n) => n.cls === 'android.widget.Button' && /페르소나/.test(`${n.text ?? ''}${n.desc ?? ''}`)), 'persona chip'),
    centre(nodes.find((n) => /버전/.test(n.text ?? '')), 'version text'),
  ]
} else {
  targets = nodes.filter((n) => n.cls === 'android.widget.Button').slice(0, 3).map((b) => centre(b, b.text || b.desc || 'button'))
}
res.exploreTargets = targets
for (const tg of targets) {
  if (tg.x === null) { res.explore.push({ target: tg, landed: false, skipped: 'not on screen' }); continue }
  // A slow 80 px drag through the target: WebView hit-tests on hover moves, which a stationary injected tap never sends
  // (a real finger always jitters). Slow enough that the gesture detector does not classify it as a swipe.
  const r = await act(`/path?pts=${tg.x - 40},${tg.y}_${tg.x + 40},${tg.y}&ms=800`)
  res.explore.push({ target: tg, ...r, landed: isWeb(r.focus) && inside(r.focus, tg.x, tg.y) })
}
res.explorePass = res.explore.filter((e) => e.landed).length >= 2 && targets.length === 3
res.tree = await get('/tree?max=80')
writeFileSync(outFile, JSON.stringify(res, null, 1))
console.log(JSON.stringify({ app, linearPass: res.linearPass, firstWebStep: res.firstWeb?.step, firstWeb: res.firstWeb?.focus, firstWebSpeech: res.firstWeb?.speech, stuckOn: res.stuckOn, explore: res.explore.map((e) => `${e.target.name}:${e.landed ? 'LAND' : 'miss'}(${e.focus?.cls}|${e.focus?.text ?? ''}|${e.focus?.desc ?? ''})`), explorePass: res.explorePass }))

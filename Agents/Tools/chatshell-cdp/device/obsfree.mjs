import fs from 'node:fs'
import { spawn } from 'node:child_process'
import { adbExe, deviceConnect, devicePort, outDir, requireSerial, safeName, sleep } from './lib.mjs'
// Observer-free acquisition. usage:
//   HARNESS_SERIAL=<adb serial> HARNESS_CDP=<forwarded port> [HARNESS_OUT=<dir outside the checkout>] [HARNESS_ADB=<adb>]
//   node obsfree.mjs <build> <trial> still <target>
//   node obsfree.mjs <build> <trial> fling <startScrollTop> <y0> <y1> <durMs>
// Page access = single Runtime.evaluate reads (+ the one scrollTop write: the jump, or the fling setup position).
// No in-page logger: no rAF chain, ResizeObserver, accessor hooks, listeners or wrapped APIs.
// Invariant: every argument, the serial, the port and the out dir are validated before a directory is made or a connection
// opened; any failure prints the usage and exits 2.
const [build, trial, mode] = process.argv.slice(2, 5)
const a = process.argv.slice(5).map(Number)
const USAGE = 'usage: HARNESS_SERIAL=<serial> HARNESS_CDP=<port> node obsfree.mjs <build> <trial> still <target> | fling <startScrollTop> <y0> <y1> <durMs>'
let SER, OUT
try {
  safeName(build); safeName(trial)
  const want = mode === 'still' ? 1 : mode === 'fling' ? 4 : -1
  if (a.length !== want || !a.every(Number.isFinite)) throw new Error('bad mode or numbers: ' + [mode, ...process.argv.slice(5)].join(' '))
  SER = requireSerial()
  devicePort()
  OUT = `${outDir()}/${build}-${trial}`
} catch (e) { console.error(String(e.message || e) + '\n' + USAGE); process.exit(2) }
const c = await deviceConnect()
fs.mkdirSync(`${OUT}/frames`, { recursive: true })

const HELPERS = `
const T=document.querySelector('[data-part=chat-transcript]');
const L=T.querySelector('[data-part=chat-message-list]');
const SEL='[data-part="chat-message-container"], [data-part="chat-first-message"]';
const idxOf=(ct)=>{if(ct.dataset&&ct.dataset.part==='chat-first-message')return -1;const m=ct.querySelector('[data-part=chat-message]');return m?Number(m.dataset.chatIndex):-2};
const r1=(v)=>Math.round(v*10)/10;`
// (a) once before the jump: held row (option A) + row 90, then keep the two element references on one plain window property
const READ_A = `(()=>{${HELPERS}
const hb=T.getBoundingClientRect();const HT=hb.top;
const rs=[];let mi=1e9;
for(const ct of L.children){if(!ct.matches(SEL))continue;const i=idxOf(ct);if(i>=0&&i<mi)mi=i;const r=ct.getBoundingClientRect();if(r.height>0&&r.bottom>HT&&r.top<hb.bottom)rs.push({ct,i,top:r.top-HT,bot:r.bottom-HT})}
rs.sort((x,y)=>x.top-y.top);
const A=rs.find(x=>x.top>=-0.5)||rs.find(x=>x.top<-0.5&&x.bot>0.5)||null;
let c90=null;for(const ct of L.children){if(idxOf(ct)===90)c90=ct}
window.__obsfreeHeld={A:A&&A.ct,R90:c90};
return {A:A&&{i:A.i,o:r1(A.top),h:r1(A.bot-A.top)},R90:c90&&{i:90,o:r1(c90.getBoundingClientRect().top-HT),h:r1(c90.getBoundingClientRect().height)},st:r1(T.scrollTop),sh:T.scrollHeight,ch:T.clientHeight,hostTop:r1(HT),hostBottom:r1(hb.bottom),iw:innerWidth,ih:innerHeight,dpr:devicePixelRatio,n:L.children.length,mi,nMsg:document.querySelectorAll('[data-part=chat-message]').length,visibleRows:rs.map(x=>x.i).join(','),dateNow:Date.now(),perfNow:performance.now()}})()`
// (b) the elements captured in (a)
const READ_B = `(()=>{${HELPERS}
const H=window.__obsfreeHeld||{};const HT=T.getBoundingClientRect().top;
const off=(el)=>el&&el.isConnected?r1(el.getBoundingClientRect().top-HT):null;
let mi=1e9;for(const m of document.querySelectorAll('[data-part=chat-message]')){const i=Number(m.dataset.chatIndex);if(i<mi)mi=i}
const H2=window.__obsfreeHeld2||{};
return {A:off(H.A),R90:off(H.R90),A2:off(H2.A2),S2:off(H2.S2),A2Conn:!!(H2.A2&&H2.A2.isConnected),AConn:!!(H.A&&H.A.isConnected),R90Conn:!!(H.R90&&H.R90.isConnected),st:r1(T.scrollTop),sh:T.scrollHeight,n:L.children.length,mi,dateNow:Date.now(),perfNow:performance.now()}})()`
// (a2) read in the SAME evaluate as the jump write, right after it: held row (option A) post-jump, straddling row, row 90, scrollTop
const JUMP_A2 = (target) => `(()=>{${HELPERS}
T.scrollTop=${target};
const hb=T.getBoundingClientRect();const HT=hb.top;
const rs=[];for(const ct of L.children){if(!ct.matches(SEL))continue;const i=idxOf(ct);const r=ct.getBoundingClientRect();if(r.height>0&&r.bottom>HT&&r.top<hb.bottom)rs.push({ct,i,top:r.top-HT,bot:r.bottom-HT})}
rs.sort((x,y)=>x.top-y.top);
const A2=rs.find(x=>x.top>=-0.5)||rs.find(x=>x.top<-0.5&&x.bot>0.5)||null;
const S2=rs.find(x=>x.top<-0.5&&x.bot>0.5)||null;
let c90=null;for(const ct of L.children){if(idxOf(ct)===90)c90=ct}
window.__obsfreeHeld2={A2:A2&&A2.ct,S2:S2&&S2.ct};
return {A2:A2&&{i:A2.i,o:r1(A2.top)},S2:S2&&{i:S2.i,o:r1(S2.top)},R90:c90&&{i:90,o:r1(c90.getBoundingClientRect().top-HT)},st:r1(T.scrollTop),sh:T.scrollHeight,n:L.children.length,visibleRows:rs.map(x=>x.i).join(',')}})()`
const POLL = `(()=>{let mi=1e9,n=0;for(const m of document.querySelectorAll('[data-part=chat-message]')){n++;const i=Number(m.dataset.chatIndex);if(i<mi)mi=i}return {n,mi,L:document.querySelector('[data-part=chat-message-list]').children.length,dateNow:Date.now()}})()`

// opener tail: real touch drag older until the header hides
for (let k = 0; k < 6; k++) {
  const x = 200, y0 = 250
  await c.touch('touchStart', [[x, y0]])
  for (let i = 1; i <= 10; i++) { await c.touch('touchMove', [[x, y0 + i * 20]]); await sleep(16) }
  await c.touch('touchEnd', [])
  await sleep(700)
  if (await c.ev(`document.querySelector('[data-part=chat-header]').hasAttribute('data-hidden')`)) break
}
const hdrHidden = await c.ev(`document.querySelector('[data-part=chat-header]').hasAttribute('data-hidden')`)
let startScrollTop = null
if (mode === 'fling') {
  // setup position only (one write), settle, then the trial proper starts
  await c.ev(`(()=>{const T=document.querySelector('[data-part=chat-transcript]');T.scrollTop=${a[0]};return 1})()`)
  await sleep(700)
}
// clock alignment (device Date.now vs host Date.now), three single reads
const clk = []
for (let i = 0; i < 3; i++) { const h0 = Date.now(); const d = await c.ev('Date.now()'); const h1 = Date.now(); clk.push({ h0, h1, d }) }

// screencast through the whole trial
const frames = []
c.on(m => {
  if (m.method !== 'Page.screencastFrame') return
  frames.push({ hostT: Date.now(), ts: m.params.metadata.timestamp, meta: m.params.metadata, data: m.params.data })
  c.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {})
})
await c.send('Page.startScreencast', { format: 'jpeg', quality: 70, maxWidth: 411, maxHeight: 1400, everyNthFrame: 1 })
await sleep(400)

const ra = await c.ev(READ_A)
const preMin = ra.mi
const tA = Date.now()
let jumpT = null, swipeT = null, swipeProc = null, ra2 = null
if (mode === 'still') {
  ra2 = await c.ev(JUMP_A2(a[0]))
  jumpT = Date.now()
} else {
  swipeT = Date.now()
  swipeProc = spawn(adbExe(), ['-s', SER, 'shell', 'input', 'swipe', '540', String(a[1]), '540', String(a[2]), String(a[3])], { stdio: 'ignore' })
}
// poll the mounted count / min index with single cheap reads
const polls = []
let detect = null
const t0 = Date.now()
while (Date.now() - t0 < 6000) {
  const ts = Date.now()
  const p = await c.ev(POLL)
  polls.push({ host: ts, hostDone: Date.now(), ...p })
  if (p.mi < preMin || p.n !== ra.nMsg) { detect = { host: ts, hostDone: Date.now(), ...p }; break }
  const wait = 100 - (Date.now() - ts)
  if (wait > 0) await sleep(wait)
}
let b500 = null, b1000 = null
if (detect) {
  await sleep(Math.max(0, detect.host + 500 - Date.now()))
  const th = Date.now(); b500 = { host: th, ...(await c.ev(READ_B)) }; b500.hostDone = Date.now()
  await sleep(Math.max(0, detect.host + 1000 - Date.now()))
  const th2 = Date.now(); b1000 = { host: th2, ...(await c.ev(READ_B)) }; b1000.hostDone = Date.now()
  await sleep(500)
} else await sleep(800)
await c.send('Page.stopScreencast')
await sleep(300)
await c.ev('(()=>{delete window.__obsfreeHeld;delete window.__obsfreeHeld2;return 1})()')
let i = 0
const frameMeta = []
for (const f of frames) {
  const name = `f${String(i).padStart(4, '0')}.jpg`
  fs.writeFileSync(`${OUT}/frames/${name}`, Buffer.from(f.data, 'base64'))
  frameMeta.push({ name, hostT: f.hostT, ts: f.ts, offsetTop: f.meta.offsetTop, pageScale: f.meta.pageScaleFactor, deviceWidth: f.meta.deviceWidth, deviceHeight: f.meta.deviceHeight, scrollY: f.meta.scrollOffsetY })
  i++
}
const raw = { build, trial, mode, params: a, hdrHidden, clk, ra, ra2, preMin, tA, jumpT, swipeT, polls, pollCount: polls.length, detect, b500, b1000, frameCount: frames.length, frameMeta }
fs.writeFileSync(`${OUT}/raw.json`, JSON.stringify(raw, null, 1))
console.log(JSON.stringify({ build, trial, mode, hdrHidden, preMin, polls: polls.length, detect: detect && { n: detect.n, mi: detect.mi, tAfterStartMs: detect.host - (jumpT || swipeT) }, frames: frames.length, A: ra.A, R90: ra.R90, st: ra.st, b500: b500 && [b500.A, b500.R90, b500.st], b1000: b1000 && [b1000.A, b1000.R90, b1000.st] }))
process.exit(0)

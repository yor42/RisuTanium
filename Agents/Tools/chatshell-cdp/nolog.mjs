import fs from 'node:fs'
import path from 'node:path'
import { connect, sleep, phoneMode, openChat, outDir } from './lib.mjs'
// Observer-free cross-check. usage: node nolog.mjs <version> <target> <label>
// No in-page logger: three plain Runtime.evaluate reads (right after the harness write, +500 ms, +1000 ms). The only page state is
// window.__nl (element references to the held row A and row P), set in the same evaluate as the write.
const [version, target, label] = process.argv.slice(2)
const c = await connect(); await phoneMode(c)
await openChat(c, 89)
for (let k = 0; k < 6; k++) {
  const x = 200, y0 = 250
  await c.touch('touchStart', [[x, y0]])
  for (let i = 1; i <= 10; i++) { await c.touch('touchMove', [[x, y0 + i * 20]]); await sleep(16) }
  await c.touch('touchEnd', [])
  await sleep(700)
  if (await c.ev(`document.querySelector('[data-part=chat-header]').hasAttribute('data-hidden')`)) break
}
const hdr = await c.ev(`document.querySelector('[data-part=chat-header]').hasAttribute('data-hidden')`)
const common = `
const T=document.querySelector('[data-part=chat-transcript]');
const r1=v=>Math.round(v*10)/10;
const rowEls=()=>{const c=T.querySelector('[data-part=chat-message-container]');return c?[...c.parentElement.children].filter(e=>e.matches('[data-part="chat-message-container"], [data-part="chat-first-message"]')):[]};
const ix=el=>{const a=el.querySelector('[data-part=chat-message]');return a?Number(a.dataset.chatIndex):(el.matches('[data-part=chat-first-message]')?-1:-2)};
const snap=()=>{const HT=T.getBoundingClientRect().top,ch=T.clientHeight;const rows=rowEls().map(el=>{const r=el.getBoundingClientRect();return{el,top:r.top-HT,h:r.height,idx:ix(el)}}).filter(r=>r.h>0).sort((a,b)=>a.top-b.top);let A=null,S=null;for(const r of rows){if(!S&&r.top<-0.5&&r.top+r.h>0.5)S=r;if(!A&&r.top>=-0.5&&r.top<ch)A=r}return{HT,rows,A:A||S,S}};
`
const pre = JSON.parse(await c.ev(`(()=>{${common}
const s=snap();let pm=1e9,pe=null;for(const r of s.rows){if(r.idx>=0&&r.idx<pm){pm=r.idx;pe=r.el}}
const pHT=T.getBoundingClientRect().top;
window.__nl={P:pe};
return JSON.stringify({st:T.scrollTop,sh:T.scrollHeight,n:s.rows.length,A:s.A&&[s.A.idx,r1(s.A.top),r1(s.A.h)],P:[pm,r1(pe.getBoundingClientRect().top-pHT)]})})()`))
// write and the "after write" read in the same evaluate (the held rows are taken here, before the load)
let w = JSON.parse(await c.ev(`(()=>{${common}
const t0=performance.now();T.scrollTop=${Number(target)};const s=snap();window.__nl.A=s.A&&s.A.el;window.__nl.t0=t0;
const P=window.__nl.P;
return JSON.stringify({t:0,st:T.scrollTop,sh:T.scrollHeight,n:s.rows.length,A:s.A&&[s.A.idx,r1(s.A.top),r1(s.A.h)],P:[ix(P),r1(P.getBoundingClientRect().top-T.getBoundingClientRect().top)]})})()`))
let tw = Date.now()
const reads = []
const rd = async (wait) => {
  await sleep(wait)
  return JSON.parse(await c.ev(`(()=>{${common}
const N=window.__nl;const HT=T.getBoundingClientRect().top;const s=snap();
return JSON.stringify({t:r1(performance.now()-N.t0),st:T.scrollTop,sh:T.scrollHeight,n:s.rows.length,mi:Math.min(...s.rows.filter(r=>r.idx>=0).map(r=>r.idx)),Aoff:N.A&&N.A.isConnected?r1(N.A.getBoundingClientRect().top-HT):null,Aidx:N.A?ix(N.A):null,Poff:N.P.isConnected?r1(N.P.getBoundingClientRect().top-HT):null,Pidx:ix(N.P),curA:s.A&&[s.A.idx,r1(s.A.top)]})})()`))
}
// simple schedule: sleep until each wall-clock target measured by the page
async function at(ms) { await sleep(Math.max(0, ms - (Date.now() - tw))); return await rd(0) }
const p0 = null
const r5 = await at(500)
const r10 = await at(1000)
const out = { version, label, target: Number(target), hdr, pre, afterWrite: w, firstRead: p0, plus500: r5, plus1000: r10 }
fs.writeFileSync(path.join(outDir(), `nl-${version}-${label}.json`), JSON.stringify(out))
const d = (r, k, base) => (r[k] === null || base === null || base === undefined ? null : Math.round((r[k] - base) * 10) / 10)
console.log(JSON.stringify({ version, label, target: Number(target), hdr, pre, afterWrite: w, first: p0, r500: { ...r5, dA: d(r5, 'Aoff', w.A && w.A[1]), dP: d(r5, 'Poff', w.P[1]) }, r1000: { ...r10, dA: d(r10, 'Aoff', w.A && w.A[1]), dP: d(r10, 'Poff', w.P[1]) } }))
process.exit(0)

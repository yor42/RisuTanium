// Sidebar X hit-test: narrow emulation 360x668, shell ON (profile flag), chat open, sidebar open.
import { connect, sleep, outDir, openChat } from './lib.mjs'
import fs from 'node:fs'
import path from 'node:path'
const label = process.argv[2] || 'run'
const c = await connect()
await c.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 668, deviceScaleFactor: 2.8125, mobile: true })
await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await openChat(c, 157)
const shellOn = await c.ev("localStorage.getItem('risuChatShell.enabled')")
const headerBefore = await c.ev("(()=>{const h=document.querySelector('[data-part=chat-header]');if(!h)return null;const r=h.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,hidden:h.getAttribute('data-hidden')}})()")
await c.tap(22, 34); await sleep(1500)
const info = await c.ev(`(()=>{
 const path = (el) => { const a=[]; for (let e=el; e; e=e.parentElement) a.push(e.tagName.toLowerCase()+(e.getAttribute('class')?'.'+e.getAttribute('class').trim().split(/\\s+/).join('.'):'')+(e.dataset&&e.dataset.part?'[data-part='+e.dataset.part+']':'')); return a.reverse() }
 const rect = (e) => { if(!e) return null; const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,bottom:r.bottom,right:r.right} }
 const x=[...document.querySelectorAll('svg.lucide-x')].find(e=>e.getBoundingClientRect().width>0)
 const hdr=document.querySelector('[data-part=chat-header]')
 const xr=x?x.getBoundingClientRect():null
 const cx=xr?xr.x+xr.width/2:295, cy=xr?xr.y+xr.height/2:33
 const hit=document.elementFromPoint(cx,cy)
 return {cx,cy,xRect:rect(x),headerRect:rect(hdr),hdrHidden:hdr&&hdr.getAttribute('data-hidden'),sidebarOpen:document.querySelectorAll('.dynamic-sidebar').length,hitPath:hit?path(hit):null,hitIsHeaderDescendant:!!(hit&&hit.closest('[data-part=chat-header]')),
   stackAtPoint:document.elementsFromPoint(cx,cy).map(e=>e.tagName.toLowerCase()+(e.getAttribute('class')?'.'+e.getAttribute('class').trim().split(/\\s+/).slice(0,3).join('.'):'')+(e.dataset&&e.dataset.part?'[data-part='+e.dataset.part+']':'')).slice(0,8)}
})()`)
await c.shot('sidebarX-' + label + '-before')
await c.touch('touchStart', [[info.cx, info.cy]]); await sleep(60); await c.touch('touchEnd', []); await sleep(1500)
const after = await c.ev("document.querySelectorAll('.dynamic-sidebar').length")
await c.shot('sidebarX-' + label + '-after')
const out = { label, viewport: '360x668', shellOn, headerBefore, info, sidebarElementsAfterTap: after, closed: info.sidebarOpen > 0 && after === 0 }
fs.writeFileSync(path.join(outDir(), `sidebarX-${label}.json`),JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1)); process.exit(0)


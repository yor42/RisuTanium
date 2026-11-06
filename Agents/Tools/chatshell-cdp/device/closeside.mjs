import { deviceConnect, sleep } from './lib.mjs'
// real touch tap on the dimmed area beside the sidebar while the sidebar (new-chat button) is visible, then report scroll state
const c = await deviceConnect()
const open = () => c.ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.innerText.trim()==='새 채팅');if(!b)return false;const r=b.getBoundingClientRect();return r.width>0&&r.x>=0&&r.x<411})()`)
const was = await open()
for (let k = 0; k < 3 && await open(); k++) { await c.tap(392, 400); await sleep(1200) }
console.log(JSON.stringify({ sidebarWasOpen: was, state: await c.ev(`(()=>{const t=document.querySelector('[data-part=chat-transcript]');const h=document.querySelector('[data-part=chat-header]');return {top:Math.round(t.scrollTop),max:t.scrollHeight-t.clientHeight,hdrTop:h.getBoundingClientRect().top,n:document.querySelectorAll('[data-part=chat-message]').length}})()`), sidebarStillOpen: await open() }))
process.exit(0)

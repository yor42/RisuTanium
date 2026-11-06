import { connect, sleep, phoneMode } from './lib.mjs'
// usage: node build.mjs send <n> | reroll <n> | step <prev|next> | state
const [mode, arg] = process.argv.slice(2)
const c = await connect(); await phoneMode(c); await sleep(500)
const rows = () => c.ev(`document.querySelectorAll('[data-part=chat-message]').length`)
const total = () => c.ev(`Math.max(...[...document.querySelectorAll('[data-part=chat-message]')].map(m=>Number(m.dataset.chatIndex)))`)
const state = () => c.ev(`JSON.stringify({newest:Math.max(...[...document.querySelectorAll('[data-part=chat-message]')].map(m=>Number(m.dataset.chatIndex))),mounted:document.querySelectorAll('[data-part=chat-message]').length,alts:[...document.querySelectorAll('[data-part=chat-message]')].filter(m=>m.querySelector('[data-part=chat-message-alts]')).map(m=>m.dataset.chatIndex+':'+m.querySelector('[data-part=chat-message-alts]').getAttribute('aria-label')),t:(t=>[t.scrollTop,t.scrollHeight,t.clientHeight])(document.querySelector('[data-part=chat-transcript]'))})`)
async function waitIdx(prev) { for (let i = 0; i < 100; i++) { await sleep(150); const t = await total(); if (t >= prev + 2) { await sleep(300); return t } } return await total() }
if (mode === 'send') {
  for (let i = 0; i < Number(arg); i++) {
    const before = await total()
    await c.ev("document.querySelector('[data-part=chat-composer-input]').focus()"); await sleep(150)
    await c.send('Input.insertText', { text: process.env.SENDTEXT || ('msg ' + (before + 1)) }); await sleep(150)
    const r = await c.ev("(()=>{const b=document.querySelector('[data-part=chat-send]');const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
    await c.tap(r[0], r[1]); await waitIdx(before)
  }
} else if (mode === 'reroll') {
  for (let i = 0; i < Number(arg); i++) {
    const r = await c.ev("(()=>{const ms=[...document.querySelectorAll('[data-part=chat-message]')];const m=ms.reduce((a,x)=>Number(x.dataset.chatIndex)>Number(a.dataset.chatIndex)?x:a);const b=[...m.querySelectorAll('[data-part=chat-message-alts] button')].find(b=>b.innerText.includes('새 답변'));b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()")
    await c.tap(r[0], r[1]); await sleep(3000)
  }
} else if (mode === 'step') {
  const r = await c.ev(`(()=>{const ms=[...document.querySelectorAll('[data-part=chat-message]')];const m=ms.reduce((a,x)=>Number(x.dataset.chatIndex)>Number(a.dataset.chatIndex)?x:a);const b=m.querySelector('[data-part=chat-message-alts] button[aria-label=${JSON.stringify(arg === 'prev' ? '이전 답변' : '다음 답변')}]');b.scrollIntoView({block:'center'});const r=b.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`)
  await c.tap(r[0], r[1]); await sleep(1500)
}
console.log(await state()); process.exit(0)

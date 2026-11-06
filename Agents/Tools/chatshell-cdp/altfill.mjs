// prep helper: fill the 추가 첫 메시지 list of the open character editor (고급 설정 tab) with Alt A..C
import { connect, sleep, phoneMode } from './lib.mjs'
const c = await connect(); await phoneMode(c); await sleep(300)
const tbl = `([...document.querySelectorAll('*')].filter(x=>x.children.length===0&&x.textContent.trim()==='추가 첫 메시지')[0].nextElementSibling)`
const count = () => c.ev(`${tbl}.querySelectorAll('textarea').length`)
const plus = () => c.ev(`(()=>{const t=${tbl}.querySelector('th button');t.scrollIntoView({block:'center'});const r=t.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`)
const want = process.argv.slice(2).length ? process.argv.slice(2) : ['Alt A', 'Alt B', 'Alt C']
for (const [i, txt] of want.entries()) {
  while ((await count()) < i + 1) { const p = await plus(); await c.tap(p[0], p[1]); await sleep(600) }
  await c.ev(`(()=>{const t=${tbl}.querySelectorAll('textarea')[${i}];t.scrollIntoView({block:'center'});t.focus();return 1})()`); await sleep(300)
  await c.send('Input.insertText', { text: txt }); await sleep(400)
}
console.log('count', await count(), await c.ev(`JSON.stringify([...${tbl}.querySelectorAll('textarea')].map(t=>t.value))`))
await c.shot('altfill'); process.exit(0)

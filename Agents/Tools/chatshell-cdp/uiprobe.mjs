// usage: node uiprobe.mjs <shotName> [tap:x,y | wait:ms | text:str | ev:expr]...   (prep helper; phone emulation, then screenshot + visible text)
import { connect, sleep, phoneMode } from './lib.mjs'
const [shot, ...steps] = process.argv.slice(2)
const c = await connect(); await phoneMode(c); await sleep(300)
for (const s of steps) {
  const i = s.indexOf(':'), k = s.slice(0, i), v = s.slice(i + 1)
  if (k === 'tap') { const [x, y] = v.split(',').map(Number); await c.tap(x, y); await sleep(700) }
  else if (k === 'wait') await sleep(Number(v))
  else if (k === 'text') { await c.send('Input.insertText', { text: v }); await sleep(300) }
  else if (k === 'ev') console.log('ev=>', JSON.stringify(await c.ev(v)))
}
console.log(await c.ev(`document.body.innerText.slice(0,500)`))
await c.shot(shot); process.exit(0)

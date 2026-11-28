// Shared flow helpers for S3d4 PC runs (scratch).
import { connect, sleep, APP } from './cdplib.mjs'
export { connect, sleep, APP }

export async function mouseAt(c, x, y) {
  await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
  await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
}

// Finds exactly one visible element matching selector whose trimmed text/aria-label equals `text` (or any when text is null), scrolls it into view,
// checks elementFromPoint lands inside it, and returns its centre. Throws on 0 or >1 matches.
export async function locate(c, selector, text) {
  const r = await c.ev(`(()=>{const want=${JSON.stringify(text)};const els=[...document.querySelectorAll(${JSON.stringify(selector)})].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&(want===null||(e.innerText||e.getAttribute('aria-label')||'').trim()===want)});if(els.length!==1)return {n:els.length};const e=els[0];e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;const u=document.elementFromPoint(x,y);return {n:1,x,y,inside:!!u&&(e===u||e.contains(u)||u.contains(e))}})()`)
  if (r.n !== 1) throw new Error(`locate ${selector} ${text}: ${r.n} matches`)
  if (!r.inside) throw new Error(`locate ${selector} ${text}: elementFromPoint is not inside the target`)
  return r
}
export async function clickSel(c, selector, text = null) {
  const p = await locate(c, selector, text)
  await mouseAt(c, p.x, p.y)
  return p
}
export async function waitFor(c, expr, timeoutMs = 30000, stepMs = 100) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (await c.ev(expr)) return Date.now() - t0
    await sleep(stepMs)
  }
  throw new Error('waitFor timeout: ' + expr.slice(0, 120))
}
export async function dismissNotices(c) {
  // The app's own informational dialogs (single OK button); returns the texts dismissed.
  const seen = []
  for (let i = 0; i < 4; i++) {
    const t = await c.ev(`(()=>{const b=[...document.querySelectorAll('button')].filter(e=>e.innerText.trim()==='OK'&&e.getBoundingClientRect().width>0);if(b.length!==1)return null;const d=b[0].parentElement;return (d?d.innerText:'').slice(0,120)})()`)
    if (!t) break
    seen.push(t.replace(/\n+/g, ' / '))
    await clickSel(c, 'button', 'OK')
    await sleep(600)
  }
  return seen
}
export async function setViewport(c) {
  const { setNarrow } = await import('./vp.mjs'); await setNarrow(c)
}
export async function reloadApp(c, settleMs = 8000) {
  await c.send('Page.navigate', { url: APP })
  await waitFor(c, `document.readyState==='complete'&&document.body&&document.body.innerText.length>20`, 60000, 250)
  await sleep(settleMs)
}

// CDP helper for the #301 PC run (scratch, outside the repository). Node's global WebSocket; CDP only.
import fs from 'node:fs'
export const PORT = Number(process.env.R301_CDP || 9511)
export const APP = process.env.R301_APP || 'http://127.0.0.1:6311/'
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function connect() {
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()
  const pages = list.filter((x) => x.type === 'page')
  if (pages.length !== 1) throw new Error('pages=' + pages.length + ' ' + pages.map((p) => p.url).join(','))
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pend = new Map()
  const listeners = []
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString())
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } else if (m.method) listeners.forEach((l) => l(m))
  })
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id
    pend.set(i, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600))
    return r.result.value
  }
  const shot = async (file) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file }
  const on = (l) => listeners.push(l)
  on((m) => { if (m.method === 'Page.javascriptDialogOpening') send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}) })
  await send('Page.enable'); await send('Runtime.enable')
  if (!process.env.S3D4_NOVP) { const { setNarrow } = await import('./vp.mjs'); await setNarrow({ send }) }
  return { ws, send, ev, shot, on }
}

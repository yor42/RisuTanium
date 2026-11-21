// node Agents/Tools/chatshell-cdp/tests/beforeunload.accept.mjs
// Acceptance test: connect() answers the beforeunload prompt a web build shows on reload after user input (#339).
// Starts a scratch loopback server and a headless Chrome with a temp profile; no external host is contacted.
// Without the handler (acceptBeforeUnload: false) the post-reload evaluate must time out (red); with it, it must answer (green).
// Env: CHATSHELL_CHROME (browser path). SKIP, exit 0, if no Chrome is found. Run with node, never through vitest.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const lib = await import(pathToFileURL(path.join(HERE, '..', 'lib.mjs')).href)
const CANDIDATES = [process.env.CHATSHELL_CHROME, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
const chrome = CANDIDATES.find(p => p && fs.existsSync(p))
if (!chrome) { console.log('SKIP no Chrome found'); process.exit(0) }

const PAGE = '<!doctype html><title>t</title><button id=b style="position:fixed;left:0;top:0;width:200px;height:200px">x</button><script>window.__boot=Math.random();addEventListener("beforeunload",e=>{e.preventDefault();e.returnValue=""})</script>'
const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(PAGE) })
await new Promise(r => server.listen(0, '127.0.0.1', r))
const url = `http://127.0.0.1:${server.address().port}/`
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'chatshell-bu-'))
const port = 9600 + Math.floor(Math.random() * 300)
const proc = spawn(chrome, [`--remote-debugging-port=${port}`, `--user-data-dir=${path.join(scratch, 'profile')}`, '--headless=new', '--no-first-run', '--no-default-browser-check', 'about:blank'], { shell: false, stdio: 'ignore' })

let failures = 0
const check = (ok, name, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' :: ' + detail)); if (!ok) failures++ }
const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))])

// Fresh tab per case: a dialog left open by the red case must not block the green one.
async function freshTab() {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  for (const x of await (await fetch(`http://127.0.0.1:${port}/json`)).json()) if (x.type === 'page' && x.id !== t.id) await fetch(`http://127.0.0.1:${port}/json/close/${x.id}`)
  return t
}
async function reloadAfterClick(opts) {
  await freshTab()
  const c = await lib.connect({ port, ...opts })
  try {
    await c.send('Page.navigate', { url }); await lib.sleep(800)
    const before = await c.ev('window.__boot')
    await c.mouse('mousePressed', 50, 50); await c.mouse('mouseReleased', 50, 50)
    await c.send('Page.reload')
    await lib.sleep(500)
    const after = await timeout(c.ev('window.__boot'), 5000)
    return before !== after
  } finally { c.ws.terminate() }
}

try {
  for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${port}/json/version`); break } catch { await lib.sleep(200) } }
  let red = 'answered'
  try { await reloadAfterClick({ acceptBeforeUnload: false }) } catch (e) { red = e.message }
  check(red === 'timeout', 'without the handler the reload after a CDP click hangs', red)
  let green
  try { green = await reloadAfterClick({}) } catch (e) { green = e.message }
  check(green === true, 'with the handler the reload reaches the new document', String(green))
} finally {
  proc.kill(); server.close(); await lib.sleep(500)
  try { fs.rmSync(scratch, { recursive: true, force: true }) } catch {}
}
process.exit(failures ? 1 : 0)

// One cold #301 run (scratch). node run301.mjs <label> <outDir> [profile]
// Windows: E (type '2' in the Mood key, wait through the debounce, the save pass and idle-net slots), A (Back to the list),
// U (Update all), N (Undo all). Each window is traced with CDP Tracing, or sampled with Profiler when `profile` is given.
import fs from 'node:fs'
import zlib from 'node:zlib'
import path from 'node:path'
import { connect, sleep, mouseAt, clickSel, locate, waitFor, dismissNotices, setViewport, reloadApp } from './flow.mjs'
import { goHome } from './nav.mjs'

const [label, outDir, mode] = process.argv.slice(2)
const EDIT_WAIT = Number(process.env.R301_EDIT_WAIT || 36000)
fs.mkdirSync(outDir, { recursive: true })
const log = []
const note = (s) => { const line = `[${label}] ${s}`; log.push(line); console.log(line) }
const c = await connect()
await setViewport(c)
const CATS = ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink.user_timing', 'toplevel']

async function windowOf(name, body) {
  if (mode === 'profile') {
    await c.send('Profiler.enable')
    await c.send('Profiler.setSamplingInterval', { interval: 200 })
    await c.send('Profiler.start')
    let failure = null
    try { await body() } catch (e) { failure = e }
    const { profile } = await c.send('Profiler.stop')
    fs.writeFileSync(path.join(outDir, `${label}-${name}.cpuprofile`), JSON.stringify(profile))
    if (failure) throw failure
    return
  }
  const events = []
  let done = null
  const finished = new Promise((r) => { done = r })
  const handler = (m) => {
    if (m.method === 'Tracing.dataCollected') for (const e of m.params.value) events.push(e)
    else if (m.method === 'Tracing.tracingComplete') done()
  }
  c.on(handler)
  await c.send('Tracing.start', { traceConfig: { recordMode: 'recordAsMuchAsPossible', includedCategories: CATS }, transferMode: 'ReportEvents' })
  await sleep(400)
  let failure = null
  try { await body() } catch (e) { failure = e }
  await sleep(400)
  await c.send('Tracing.end')
  await finished
  fs.writeFileSync(path.join(outDir, `${label}-${name}.json.gz`), zlib.gzipSync(Buffer.from(JSON.stringify({ traceEvents: events }))))
  note(`trace ${name}: ${events.length} events`)
  if (failure) throw failure
}
async function toHome() {
  const vis = (name) => c.ev(`[...document.querySelectorAll('button')].some(b=>b.getBoundingClientRect().width>0&&(b.getAttribute('aria-label')||b.innerText||'').trim()===${JSON.stringify(name)})`)
  try { await clickSel(c, 'button', 'Cancel'); await sleep(600) } catch {}
  if (!(await vis('Home'))) {
    if (!(await vis('Close sidebar'))) { await clickSel(c, 'button', 'Sidebar'); await sleep(1200) }
    await mouseAt(c, 30, 24); await sleep(1200)
  }
  await clickSel(c, 'button', 'Home'); await sleep(1800)
}const mark = (m) => c.ev(`performance.mark(${JSON.stringify(m)}); performance.now()`)
const afterPaint = () => c.ev(`new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(performance.now()))))`)

await reloadApp(c, 7000)
note('notices: ' + JSON.stringify(await dismissNotices(c)))
// A longtask observer in the page: threshold 50 ms, so it is a cross-check, not the task record.
await c.ev(`(()=>{window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push([Math.round(e.startTime),Math.round(e.duration)])}).observe({type:'longtask',buffered:true});return 1})()`)
if (!(await c.ev("!!document.querySelector('[data-part=studio]')"))) {
  if (!(await c.ev("document.body.innerText.includes('Open in Studio: S3d4')"))) { await toHome(); try { await clickSel(c, 'button', 'Character'); await sleep(1500) } catch { note('no Character button') } }
  await clickSel(c, 'button', 'Open in Studio: S3d4 Large Synthetic'); await sleep(2500)
}await mouseAt(c, 100, 22); await sleep(1200)
await waitFor(c, `[...document.querySelectorAll('span')].some(e=>e.innerText.trim()==='Toggle definitions')`, 20000)
await clickSel(c, 'span', 'Toggle definitions'); await sleep(1200)
await clickSel(c, 'span', 'Mood'); await sleep(900)
await c.ev(`document.querySelector('[data-part=studio-toggle-advanced]').open = true`)
await sleep(400)
note('key before: ' + await c.ev(`(()=>{const i=document.querySelector('[data-part=studio-toggle-key]');i.focus();i.setSelectionRange(i.value.length,i.value.length);return i.value})()`))
await sleep(1500)

await windowOf('E', async () => {
  await mark('r301-type')
  await c.send('Input.insertText', { text: '2' })
  await waitFor(c, `document.querySelector('[data-part=studio-toggle-key]')?.value==='mood2'`, 5000, 20)
  await mark('r301-typed')
  await sleep(EDIT_WAIT)
})
note('longtasks after edit window (start,dur): ' + JSON.stringify(await c.ev('window.__lt')))
await c.ev('window.__lt.length=0')
if (process.env.R301_EDIT_ONLY === '1') process.exit(0)

await windowOf('A', async () => {
  await mark('r301-back')
  await clickSel(c, 'button', 'Back to the list')
  await waitFor(c, `!!document.querySelector('[data-part=studio-toggle-uses]')`, 60000, 20)
  await afterPaint()
  await mark('r301-uses-painted')
  await sleep(6000)
})
note('longtasks A: ' + JSON.stringify(await c.ev('window.__lt'))); await c.ev('window.__lt.length=0')
const upd = await locate(c, '[data-part=studio-toggle-uses-update]', null)
await windowOf('U', async () => {
  await mark('r301-update')
  await mouseAt(c, upd.x, upd.y)
  await waitFor(c, `!!document.querySelector('[data-part=studio-toggle-uses-result]')`, 60000, 10)
  await afterPaint()
  await mark('r301-update-painted')
  await sleep(6000)
})
note('longtasks U: ' + JSON.stringify(await c.ev('window.__lt'))); await c.ev('window.__lt.length=0')
const und = await locate(c, '[data-part=studio-toggle-uses-undo]', null)
await windowOf('N', async () => {
  await mark('r301-undo')
  await mouseAt(c, und.x, und.y)
  await waitFor(c, `!document.querySelector('[data-part=studio-toggle-uses-result]')`, 60000, 10)
  await afterPaint()
  await mark('r301-undo-painted')
  await sleep(EDIT_WAIT)
})
note('longtasks N: ' + JSON.stringify(await c.ev('window.__lt')))
fs.writeFileSync(path.join(outDir, `${label}-notes.json`), JSON.stringify({ label, mode: mode ?? 'trace', log }, null, 2))
process.exit(0)







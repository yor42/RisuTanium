// node Agents/Tools/device/tests/probe-longtask-rebuild.accept.mjs
// Acceptance test of probes/probe-longtask-rebuild.js on the PC, no device: the probe is injected into a headless Chrome page
// by cdp-session.mjs `probe` (so T1 and T2 are tested together), and the page scenario runs through cdp-session.mjs `eval`.
// Env: PROBE_PATH (another copy of the probe, for mutant runs), CDP_SESSION_PATH, CDP_ACCEPT_SCRATCH, CHROME_PATH.
// Plain asserts print PASS/FAIL; exit 0 only if every assert holds.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOL = process.env.CDP_SESSION_PATH ?? path.join(HERE, '..', 'cdp-session.mjs')
const PROBE = process.env.PROBE_PATH ?? path.join(HERE, '..', 'probes', 'probe-longtask-rebuild.js')
const SCRATCH = process.env.CDP_ACCEPT_SCRATCH ?? mkdtempSync(path.join(os.tmpdir(), 'probe-accept-'))
mkdirSync(SCRATCH, { recursive: true })

let failures = 0
const check = (ok, name, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : (detail ? ' :: ' + detail : '')))
  if (!ok) failures++
}
for (const file of [TOOL, PROBE]) {
  if (!existsSync(file)) { console.log('FAIL missing file ' + file); process.exit(1) }
}

function runTool(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [TOOL, ...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)) }) })

const chromePath = [process.env.CHROME_PATH, 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
  .find((candidate) => candidate && existsSync(candidate))
if (!chromePath) { console.log('FAIL headless Chrome not found; set CHROME_PATH'); process.exit(1) }

// The page: 30 message-body elements; __scenario() replaces them at 0 ms, 300 ms and 340 ms, then runs a 120 ms busy loop
// and adds records to fake rings that __installRings() defines.
const pagePath = path.join(SCRATCH, 'fixture.html')
writeFileSync(pagePath, `<!doctype html><title>fixture</title><body><div id="list"></div><script>
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function fill() {
  const list = document.getElementById('list')
  const wrapper = document.createElement('div')
  for (let i = 0; i < 30; i++) {
    const row = document.createElement('div')
    const body = document.createElement('span')
    body.className = 'text chattext prose'
    body.appendChild(document.createElement('b'))
    row.appendChild(body)
    wrapper.appendChild(row)
  }
  list.replaceChildren(...wrapper.childNodes)
}
fill()
function busy(ms) { const end = performance.now() + ms; while (performance.now() < end) { Math.sqrt(Math.random()) } }
const rings = { phases: [{ kind: 'script', mode: 'old', t: 1, ms: 1, cache: 'hit', scans: 1, earlyRejects: 0 }], commit: [{ kind: 'ordinary', outcome: 'committed', units: 1 }], savePass: [], units: [], yieldGap: [] }
window.__installRings = () => {
  window.__risuChatPhases = { snapshot: () => rings.phases.map((r) => ({ ...r })) }
  window.__risuCommitMeter = { all: () => [...rings.commit] }
  window.__risuSavePassMeter = { all: () => [...rings.savePass], units: () => [...rings.units] }
  window.__risuYieldGapMeter = { all: () => [...rings.yieldGap] }
}
window.__scenarioStart = () => { scenario(); return true }
async function scenario() {
  fill(); await wait(300); fill(); await wait(40); fill()
  rings.phases.push({ kind: 'script', mode: 'editdisplay', t: performance.now(), ms: 3, cache: 'miss', scans: 4, earlyRejects: 2 })
  rings.phases.push({ kind: 'script', mode: 'editprocess', t: performance.now(), ms: 2, cache: 'hit', scans: 1, earlyRejects: 0 })
  rings.phases.push({ kind: 'select', point: 'start', t: performance.now(), sinceStartMs: 0 })
  rings.commit.push({ kind: 'ordinary', outcome: 'committed', units: 3, totalBytes: 100, ms: 5, overlapped: false, secret: 'must-not-appear' })
  rings.commit.push({ kind: 'bulk', outcome: 'committed', units: 3, totalBytes: 50, ms: 4, overlapped: false })
  rings.savePass.push({ kind: 'pass', ms: 9, someObject: { a: 1 } })
  rings.units.push({ a: 1 }, { a: 2 }, { a: 3 })
  rings.yieldGap.push({ label: 'a', gapMs: 12 })
  await wait(100)
  busy(120)
}
window.__fillFullRing = () => {
  rings.commit.length = 0
  for (let i = 0; i < 1000; i++) rings.commit.push({ kind: 'ordinary', outcome: 'committed', units: 1, n: i })
  return rings.commit.length
}
window.__fullScenarioStart = () => {
  for (let i = 0; i < 5; i++) { rings.commit.push({ kind: 'bulk', outcome: 'committed', units: 2, n: 1000 + i }); rings.commit.shift() }
  return rings.commit.length
}
</script></body>\n`)

const chromePort = await freePort()
const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=' + chromePort, '--user-data-dir=' + path.join(SCRATCH, 'chrome-profile'), pathToFileURL(pagePath).href], { stdio: 'ignore' })

const probeRun = async (name, seconds, trigger) => {
  const out = path.join(SCRATCH, name + '.json')
  const run = runTool([String(chromePort), 'probe', '--probe', PROBE, '--seconds', String(seconds), '--out', out, '--label', name])
  if (trigger) { await sleep(1000); await trigger() }
  const result = await run
  if (result.code !== 0) return { exit: result.code, stderr: result.stderr }
  return { exit: 0, json: JSON.parse(readFileSync(out, 'utf8')).probe }
}

try {
  let up = false
  for (let i = 0; i < 60 && !up; i++) {
    try { up = (await fetch('http://127.0.0.1:' + chromePort + '/json')).ok } catch { await sleep(500) }
  }
  check(up, 'chrome started on a free port')
  if (up) {
    await sleep(1000)

    // a page with no rings: the probe says so loudly
    const bare = await probeRun('bare', 1)
    check(bare.exit === 0 && bare.json.ringsPresent === false && bare.json.warnings.some((w) => w.includes('not a MEASURE build')), '2e no rings gives ringsPresent:false and a warning', JSON.stringify(bare).slice(0, 300))
    check(bare.json.rings.commit.status === 'absent', '2e absent rings are recorded as absent')
    const gone0 = await runTool([String(chromePort), 'eval', '-e', 'typeof window.__devb32Probe'])
    check(gone0.stdout.trim() === '"undefined"', '2d the probe property is removed after stop (bare run)', gone0.stdout)

    await runTool([String(chromePort), 'eval', '-e', 'window.__installRings()'])
    const main = await probeRun('main', 4, () => runTool([String(chromePort), 'eval', '-e', 'window.__scenarioStart()']))
    check(main.exit === 0, 'main probe run exits 0', JSON.stringify(main).slice(0, 300))
    const p = main.json
    // (a) remount bursts
    check(p.bursts.length === 2, '2a two bursts (replacements 300 ms apart are separate)', JSON.stringify(p.bursts))
    check(p.bursts[0].removed === 30 && p.bursts[0].added === 30 && p.bursts[0].callbacks === 1, '2a first burst is one replacement of 30', JSON.stringify(p.bursts[0]))
    check(p.bursts[1].removed === 60 && p.bursts[1].added === 60 && p.bursts[1].callbacks === 2, '2a last burst coalesces the replacement 40 ms later', JSON.stringify(p.bursts[1]))
    check(p.bursts[1].tStart - p.bursts[0].tStart >= 250 && p.bursts[1].tStart - p.bursts[0].tStart <= 400, '2a bursts are placed on the page clock about 300 ms apart', JSON.stringify(p.bursts))
    // (b) long task
    check(p.longTasks.some((task) => task.duration >= 100), '2b a long task of at least 100 ms from the 120 ms busy loop', JSON.stringify(p.longTasks))
    // frames
    check(p.frames.count > 0 && Object.values(p.frames.histogramMs).reduce((a, b) => a + b, 0) === p.frames.count - 1, '2f rAF frames are counted and binned', JSON.stringify(p.frames).slice(0, 300))
    check(p.frames.largestGaps.length > 0 && p.frames.largestGaps.length <= 20 && p.frames.largestGaps[0].gapMs >= 80, '2f the largest gap (80 ms or more) includes the busy loop and the list is bounded', JSON.stringify(p.frames.largestGaps.slice(0, 2)))
    // (c) ring deltas
    check(p.ringsPresent === true, '2c rings present')
    check(p.rings.chatPhases.countsByKind.script === 2 && p.rings.chatPhases.countsByKind.select === 1 && p.rings.chatPhases.addedCount === 3, '2c chat phase ring: the old record is excluded, 2 script + 1 select added', JSON.stringify(p.rings.chatPhases))
    check(p.rings.chatPhases.scriptScansSum === 5 && p.rings.chatPhases.scriptMsSum === 5 && p.rings.chatPhases.script[0].mode === 'editdisplay', '2c script entries carry mode, ms, cache, scans', JSON.stringify(p.rings.chatPhases.script))
    check(p.rings.commit.addedCount === 2 && p.rings.commit.sums.units === 6 && p.rings.commit.sums.totalBytes === 150, '2c commit ring delta and counter sums', JSON.stringify(p.rings.commit))
    check(!JSON.stringify(p).includes('must-not-appear'), '2c unlisted string fields are dropped from records')
    check(p.rings.savePass.addedCount === 1 && p.rings.savePassUnits.addedCount === 3 && p.rings.yieldGap.addedCount === 1, '2c save pass, unit and yield gap ring deltas', JSON.stringify(p.rings.savePass) + JSON.stringify(p.rings.savePassUnits))
    check(p.rings.savePass.added[0].someObject === undefined, '2c nested objects are dropped from records')
    // (d) cleanup
    const gone = await runTool([String(chromePort), 'eval', '-e', 'typeof window.__devb32Probe'])
    check(gone.stdout.trim() === '"undefined"', '2d the probe property is removed after stop', gone.stdout)

    // (e) a full 1000-record ring (push then shift) keeps its length; the delta must still be the true added count
    const filled = await runTool([String(chromePort), 'eval', '-e', 'window.__fillFullRing()'])
    check(filled.stdout.trim() === '1000', '2g the commit ring is full before the run', filled.stdout)
    await runTool([String(chromePort), 'eval', '-e', 'console.log("old-before-run")'])
    const full = await probeRun('full', 2, () => runTool([String(chromePort), 'eval', '-e', 'window.__fullScenarioStart()']))
    check(full.exit === 0 && full.json.rings.commit.addedCount === 5 && full.json.rings.commit.sums.units === 10, '2g full ring: 5 records added are reported as 5', JSON.stringify(full.json && full.json.rings.commit).slice(0, 300))
    check(full.exit === 0 && full.json.rings.commit.wrapped === true && full.json.rings.commit.lastStartFound === true, '2g full ring: wrapped is set because start records were evicted', JSON.stringify(full.json && full.json.rings.commit).slice(0, 300))
    // (f) console messages buffered before the run are not part of it
    const fullFile = JSON.parse(readFileSync(path.join(SCRATCH, 'full.json'), 'utf8'))
    check(fullFile.events.every((event) => event.pageMs >= 0) && !fullFile.events.some((event) => event.text.includes('old-before-run')), '2h console events older than the clock read are dropped', JSON.stringify(fullFile.events).slice(0, 300))
  }
} finally {
  spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' })
}

console.log(failures === 0 ? 'ALL PASSED' : 'FAILED: ' + failures)
process.exit(failures === 0 ? 0 : 1)

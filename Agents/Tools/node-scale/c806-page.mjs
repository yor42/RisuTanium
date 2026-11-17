// CHORE-806: real-page driver for the self-hosted Node build, over the chat-shell CDP tool (lib.mjs connect, launch-chrome.mjs).
//
//   node c806-page.mjs smoke --tag <t> --tree <pristine tree dir> --dist <measurement dist> --names <a,b,c> [--leaves <n>] [--edit] [--control <name>]
//
// A library for the stage 2-4 runners (launchChrome, closeChrome, bootPage, ...) and the G1 smoke CLI.
// Invariants:
// - Chrome starts only through Agents/Tools/chatshell-cdp/launch-chrome.mjs (node spawn, args array): the host-blocking resolver rules
//   (discord.com, *.risuai.xyz and .net) and the loopback-only proxy come with it. The profile is a fresh folder under the scratch
//   root. Every page-to-server request goes through that proxy hop, so wall times include it (README).
// - Only PIDs this tool started are killed: chrome.pid after a process-name check, and launcher.pid (also spawned here) when it
//   outlives Chrome. Never by image name. PIDs are recorded in pids.json of the run folder.
// - "Cold" here is a fresh profile or a cleared HTTP cache: the registered service worker and Cache Storage survive
//   Network.clearBrowserCache, so a boot after it is not a cold-cache boot (README). The number of navigations of a first load
//   is recorded, because the service worker may reload the page once.
// - The boot meters stay off for a boot: the localStorage switches (risu-measure-*) are set by a script added before any page
//   script runs, with the state written into the run record.
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { C806_ROOT, REPO_ROOT, commandLineOf, dirsOf, prepareDist, restoreTree, scratchPath, startServer, commitKeyHash } from './c806-server.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const CDP_DIR = process.env.CHATSHELL_CDP_DIR ? path.resolve(process.env.CHATSHELL_CDP_DIR) : path.join(REPO_ROOT, 'Agents', 'Tools', 'chatshell-cdp')
const LAUNCHER = path.join(CDP_DIR, 'launch-chrome.mjs')
export const CDP_PORT_RANGE = [9800, 9899]
export const PASSWORD_PLAINTEXT = 'c806-synthetic-password'
export const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const { connect } = await import(pathToFileURL(path.join(CDP_DIR, 'lib.mjs')).href)

function listenable(port) {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)))
  })
}

export async function pickCdpPort() {
  for (let p = CDP_PORT_RANGE[0]; p <= CDP_PORT_RANGE[1]; p++) {
    if (p === 9470) continue
    if (await listenable(p)) return p
  }
  throw new Error('no free CDP port in ' + CDP_PORT_RANGE.join('-'))
}

/** Starts Chrome through launch-chrome.mjs with a fresh profile; resolves when chrome.pid exists. */
export async function launchChrome({ runDir, profileName }) {
  scratchPath(runDir)
  fs.mkdirSync(runDir, { recursive: true })
  const profile = scratchPath(C806_ROOT, 'data', 'profiles', profileName)
  if (fs.existsSync(profile)) throw new Error('the profile folder must be fresh: ' + profile)
  const port = await pickCdpPort()
  const logFd = fs.openSync(path.join(runDir, 'launcher.log'), 'a')
  const child = spawn(process.execPath, [LAUNCHER, '--port', String(port), '--profile', profile, '--out', runDir], { stdio: ['ignore', logFd, logFd], windowsHide: true, env: { ...process.env } })
  let exited = false
  child.on('exit', () => { exited = true })
  // the launcher writes its files one after the other: all three must parse as positive integers before any is used
  const positiveIntegerIn = (name) => {
    try {
      const value = Number(fs.readFileSync(path.join(runDir, name), 'utf8').trim())
      return Number.isInteger(value) && value > 0 ? value : null
    } catch { return null }
  }
  const readLaunchFiles = () => ({ chrome: positiveIntegerIn('chrome.pid'), launcher: positiveIntegerIn('launcher.pid'), proxyPort: positiveIntegerIn('proxy.port') })
  const t0 = Date.now()
  let files = readLaunchFiles()
  while (Object.values(files).some(v => v === null) && !exited && Date.now() - t0 < 60000) { await sleep(200); files = readLaunchFiles() }
  if (Object.values(files).some(v => v === null)) {
    // a Chrome that already started is ours: end it after the name check, as closeChrome does
    if (files.chrome !== null) {
      const cmd = commandLineOf(files.chrome)
      if (cmd !== null && /chrome\.exe/i.test(cmd)) { try { process.kill(files.chrome) } catch {} }
    }
    try { child.kill() } catch {}
    throw new Error('Chrome did not start; see ' + path.join(runDir, 'launcher.log'))
  }
  const pids = { chrome: files.chrome, launcher: files.launcher, cdpPort: port, proxyPort: files.proxyPort, profile }
  fs.writeFileSync(path.join(runDir, 'pids.json'), JSON.stringify(pids, null, 2))
  return { ...pids, runDir, child, hasExited: () => exited }
}

/** Closes only the recorded Chrome (after a name check), then waits for the launcher and kills it by its recorded PID if it lingers. */
export async function closeChrome(h) {
  const result = { chrome: 'none', launcher: 'none' }
  const cmd = commandLineOf(h.chrome)
  if (cmd !== null && /chrome\.exe/i.test(cmd)) { process.kill(h.chrome); result.chrome = 'killed' } else if (cmd === null) result.chrome = 'already gone'; else result.chrome = 'refused: not chrome'
  const t0 = Date.now()
  while (!h.hasExited() && Date.now() - t0 < 15000) await sleep(200)
  if (h.hasExited()) result.launcher = 'exited'
  else {
    const lcmd = commandLineOf(h.launcher)
    if (lcmd !== null && /launch-chrome\.mjs/.test(lcmd)) { process.kill(h.launcher); result.launcher = 'killed' } else result.launcher = 'refused or gone'
  }
  return result
}

/** The localStorage switches of the meters; written before any page script runs. */
export function meterSwitchScript(switches) {
  const lines = Object.entries(switches).map(([k, v]) => `try{localStorage.setItem(${JSON.stringify(k)},${JSON.stringify(v)})}catch(e){}`)
  return lines.join(';')
}

/** Attaches to the single page, counts navigations, and adds the switch script. */
export async function attach(h, { switches = {} } = {}) {
  const c = await connect({ port: h.cdpPort })
  const state = { navigations: 0 }
  c.on((m) => { if (m.method === 'Page.frameNavigated' && !m.params.frame.parentId) state.navigations++ })
  await c.send('Network.enable')
  await c.send('Page.addScriptToEvaluateOnNewDocument', { source: meterSwitchScript(switches) })
  return { c, state }
}

/**
 * Runs `actionExpr` in the page and stamps, with the page's own performance.now(), the first moment each condition is true.
 * `conditions` is a list of { name, expr, withinMs }: the conditions are tested in order, each only after the one before it
 * was true, and `withinMs` (optional) gives up on the list when that long has passed since the previous hit. A MutationObserver
 * and a 50 ms timer trigger the tests, so a hit is stamped within a few ms of the DOM change, not at the next host poll.
 * Resolves { acted, hits: { name: ms since the action or null }, timedOut }; `acted` is false when the action threw or returned
 * false. The deltas are page-side times: no CDP round trip and no host polling interval is in them. `timeoutMs` bounds the whole call.
 */
export async function timeInPage(c, { actionExpr = 'true', conditions, timeoutMs = 60000 }) {
  const list = conditions.map(cond => `[${JSON.stringify(cond.name)}, () => (${cond.expr}), ${Number(cond.withinMs ?? 0)}]`).join(', ')
  return c.ev(`new Promise((resolve) => {
    const conditions = [${list}]
    const hits = {}
    let t0 = 0
    let prevAt = 0
    let next = 0
    let finished = false
    let acted = false
    let timedOut = false
    let pending = null
    let lastAt = -1e9
    const observer = new MutationObserver(() => schedule())
    const ticker = setInterval(() => schedule(), 50)
    const limit = setTimeout(() => { timedOut = true; finish() }, ${Number(timeoutMs)})
    function finish() {
      if (finished) return
      finished = true
      observer.disconnect()
      clearInterval(ticker)
      clearTimeout(limit)
      clearTimeout(pending)
      for (const [name] of conditions) if (!(name in hits)) hits[name] = null
      resolve({ acted, hits, timedOut })
    }
    function check() {
      if (finished) return
      while (next < conditions.length) {
        const at = performance.now()
        let ok = false
        try { ok = !!conditions[next][1]() } catch (e) { ok = false }
        if (!ok) {
          const within = conditions[next][2]
          if (within > 0 && at - prevAt > within) { timedOut = true; finish() }
          return
        }
        hits[conditions[next][0]] = +(at - t0).toFixed(1)
        prevAt = at
        next++
      }
      finish()
    }
    function schedule() {
      if (finished || pending !== null) return
      pending = setTimeout(() => { pending = null; lastAt = performance.now(); check() }, Math.max(0, 8 - (performance.now() - lastAt)))
    }
    observer.observe(document, { childList: true, subtree: true, attributes: true, characterData: true })
    t0 = performance.now()
    prevAt = t0
    try { acted = (${actionExpr}) !== false } catch (e) { acted = false }
    if (!acted) { finish(); return }
    schedule()
  })`)
}

/** The page-side expression of a click on the first element of `selector` whose first text line equals `text`; evaluates to false when there is none. */
export const clickByTextExpression = (selector, text) => `(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find(e => (e.innerText || '').split('\\n')[0].trim() === ${JSON.stringify(text)})
  if (!el) return false
  el.click()
  return true
})()`

export async function waitFor(c, expression, { timeoutMs = 60000, everyMs = 250 } = {}) {
  const t0 = Date.now()
  let last
  while (Date.now() - t0 < timeoutMs) {
    try { last = await c.ev(expression) } catch (e) { last = undefined }
    if (last) return last
    await sleep(everyMs)
  }
  throw new Error('timed out waiting for: ' + expression.slice(0, 160))
}

/** Types the one password prompt (the first sign-in sets the password, a later one asks for it), then presses its OK button. */
export async function fillPasswordPrompt(c, password = PASSWORD_PLAINTEXT) {
  await waitFor(c, `!!document.querySelector('#alert-input')`, { timeoutMs: 60000 })
  await c.ev(`(() => {
    const input = document.querySelector('#alert-input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, ${JSON.stringify(password)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
    const ok = [...input.parentElement.querySelectorAll('button')].pop()
    ok.click()
  })()`)
}

/**
 * Signs in and waits for the home screen. The page may reload itself once while its service worker registers, which drops a
 * prompt that was already answered; so the prompt is answered every time it shows (one answer per appearance) until home shows.
 * Resolves { ms, prompts } with the time from the call to home; rejects with the page snapshot if home never shows.
 */
export async function reachHome(c, { timeoutMs = 120000, password = PASSWORD_PLAINTEXT, homeSelector = '[data-part=home-landing]' } = {}) {
  const t0 = Date.now()
  let prompts = 0
  let lastAnswer = 0
  while (Date.now() - t0 < timeoutMs) {
    let state
    try { state = await c.ev(`({ home: !!document.querySelector(${JSON.stringify(homeSelector)}), prompt: !!document.querySelector('#alert-input') })`) } catch { state = { home: false, prompt: false } }
    if (state.home) return { ms: Date.now() - t0, prompts }
    if (state.prompt && Date.now() - lastAnswer > 3000) {
      prompts++
      lastAnswer = Date.now()
      try { await fillPasswordPrompt(c, password) } catch {}
    }
    await sleep(300)
  }
  throw new Error('home never showed: ' + JSON.stringify(await snapshotOf(c)))
}

/** A text snapshot of what the page shows: data-part names present and the first characters of the body text. */
export async function snapshotOf(c) {
  return c.ev(`(() => ({
    url: location.href,
    parts: [...new Set([...document.querySelectorAll('[data-part]')].map(e => e.getAttribute('data-part')))].sort(),
    text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 600),
    alertInput: !!document.querySelector('#alert-input'),
    meter: typeof globalThis.__risuSavePassMeter,
  }))()`)
}

//#region request log and UI helpers
export function readReqlog(file) {
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line))
}

/** The store2 units a request list read (GET /api/read), as the distinct decoded keys. */
export function readUnitKeys(lines) {
  const keys = new Set()
  for (const l of lines) if (l.method === 'GET' && l.route === '/api/read' && Array.isArray(l.keys)) for (const k of l.keys) if (k.startsWith('store2/')) keys.add(k)
  return keys
}

const clickByText = (c, selector, text) => c.ev(clickByTextExpression(selector, text))

/** Opens the library (the home screen's Character button) unless its search box is already there. */
export async function openLibrary(c) {
  if (!(await c.ev(`!!document.querySelector('input[placeholder=Search]')`))) {
    if (!(await clickByText(c, 'button', 'Character'))) throw new Error('no Character button on the home screen')
  }
  await waitFor(c, `!!document.querySelector('input[placeholder=Search]')`, { timeoutMs: 30000 })
}

/** The page-side expression that types `text` into the library's search box. */
export const setSearchExpression = (text) => `(() => {
    const input = document.querySelector('input[placeholder=Search]')
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(text)})
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`

export async function setSearch(c, text) {
  await c.ev(setSearchExpression(text))
}

/** The page-side condition that a library row shows exactly `name`. */
export const libraryRowExpression = (name) => `[...document.querySelectorAll('[data-part=character-name-row]')].some(e => (e.innerText || '').split('\\n')[0].trim() === ${JSON.stringify(name)})`

export const libraryRows = (c) => c.ev(`[...document.querySelectorAll('[data-part=character-name-row]')].map(e => (e.innerText || '').split('\\n')[0].trim())`)

/** Types `name` into the search box; true once exactly that row shows. */
export async function findByName(c, name, timeoutMs = 20000) {
  await setSearch(c, name)
  try {
    await waitFor(c, `[...document.querySelectorAll('[data-part=character-name-row]')].some(e => (e.innerText || '').split('\\n')[0].trim() === ${JSON.stringify(name)})`, { timeoutMs })
    return true
  } catch { return false }
}

/**
 * findByName with the search time measured in the page (timeInPage): from the typed input to the exact row. `alreadyShown`
 * is true when that row was on screen before the typing; the time is then not a search time and `searchPageMs` is null.
 */
export async function findByNameTimed(c, name, timeoutMs = 20000) {
  const alreadyShown = await c.ev(libraryRowExpression(name))
  const r = await timeInPage(c, { actionExpr: setSearchExpression(name), conditions: [{ name: 'row', expr: libraryRowExpression(name) }], timeoutMs })
  return { found: r.acted && r.hits.row !== null, searchPageMs: alreadyShown ? null : r.hits.row, alreadyShown }
}

export const sidebarButtons =(c) => c.ev(`[...document.querySelectorAll('button')].filter(e => e.offsetParent).slice(0, 24).map(e => (e.innerText || '').trim().slice(0, 30)).filter(Boolean)`)

/** A real mouse click on the first visible button whose text matches `re`; false when there is none. */
export async function mouseClick(c, re) {
  const rect = await c.ev(`(() => {
    const re = ${re.toString()}
    const el = [...document.querySelectorAll('button')].find(e => e.offsetParent && re.test((e.innerText || '').trim()))
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (rect === null) return false
  await c.mouse('mouseMoved', rect.x, rect.y)
  await c.mouse('mousePressed', rect.x, rect.y)
  await c.mouse('mouseReleased', rect.x, rect.y)
  return true
}

const visibleButtons = (c) => c.ev(`[...document.querySelectorAll('button')].filter(e => e.offsetParent).map(e => (e.getAttribute('aria-label') || e.innerText || '').trim().slice(0, 40))`)

/** Answers a start-up notice with its OK button until none shows (an empty profile shows a few, then the welcome screens). */
export async function dismissNotices(c, { max = 8 } = {}) {
  let n = 0
  while (n < max) {
    await sleep(1500)
    if (!(await clickByText(c, 'button', 'OK'))) return n
    n++
  }
  return n
}

/**
 * Restores a .bin through the page: the welcome screen's restore button opens the page's own file picker; the picker is
 * intercepted and answered with `binPath` (DOM.setFileInputFiles), so the page reads the file itself, as a user's pick would.
 * `restoreLabel` is the visible text of the restore button. The sidecar guard of c806-bin-write refuses any .bin without a
 * matching sidecar, so only a generated synthetic file can be given. Resolves when the page shows `doneSelector`.
 */
export async function importBinThroughPage(c, binPath, { restoreLabel = /백업 복원|Restore backup/, doneSelector = '[data-part=home-landing]', timeoutMs = 20 * 60 * 1000, log = () => {} } = {}) {
  const sidecar = binPath + '.c806.json'
  if (!fs.existsSync(sidecar)) throw new Error('refusing a .bin without its c806 sidecar: ' + binPath)
  const side = JSON.parse(fs.readFileSync(sidecar, 'utf8'))
  const { GENERATOR_ID } = await import(pathToFileURL(path.join(REPO_ROOT, 'Agents', 'Tools', 'save-gen', 'c806-library.mjs')).href)
  if (side.format !== 'c806-bin-sidecar/1' || side.generator !== GENERATOR_ID) throw new Error('the sidecar is not from the c806 generator (format ' + side.format + ', generator ' + side.generator + '): ' + sidecar)
  const crypto = await import('node:crypto')
  if (side.sha256 !== crypto.createHash('sha256').update(fs.readFileSync(binPath)).digest('hex')) throw new Error('the .bin does not match its sidecar sha256')
  await c.send('DOM.enable')
  await c.send('Page.setInterceptFileChooserDialog', { enabled: true })
  let chooser = null
  c.on((m) => { if (m.method === 'Page.fileChooserOpened') chooser = m.params })
  const t0 = Date.now()
  // a real mouse click: the page's picker needs a user activation, which a script click does not give
  const rect = await c.ev(`(() => {
    const re = ${restoreLabel.toString()}
    const el = [...document.querySelectorAll('button')].find(e => e.offsetParent && re.test((e.innerText || '').trim()))
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })()`)
  if (rect === null) throw new Error('no restore button on the welcome screen')
  await c.mouse('mouseMoved', rect.x, rect.y)
  await c.mouse('mousePressed', rect.x, rect.y)
  await c.mouse('mouseReleased', rect.x, rect.y)
  const w0 = Date.now()
  let answers = 0
  let lastAnswer = 0
  while (chooser === null && Date.now() - w0 < 40000) {
    // the page first asks whether to replace the current data; the answer is Yes. A consent button ignores a click that comes
    // too soon after the dialog opens, so the answer is repeated once a second until the picker opens.
    if (Date.now() - lastAnswer > 1000 && await mouseClick(c, /^(예|Yes)$/)) { answers++; lastAnswer = Date.now(); log('confirm answered Yes (' + answers + ')') }
    await sleep(100)
  }
  if (chooser === null) throw new Error('the file picker never opened')
  await c.send('DOM.setFileInputFiles', { files: [binPath], backendNodeId: chooser.backendNodeId })
  log('file given at +' + (Date.now() - t0) + ' ms')
  let lastText = ''
  while (Date.now() - t0 < timeoutMs) {
    const st = await c.ev(`({ done: !!document.querySelector(${JSON.stringify(doneSelector)}), text: document.body.innerText.replace(/\\s+/g, ' ').slice(0, 300), buttons: [...document.querySelectorAll('button')].filter(e => e.offsetParent).map(e => (e.innerText || '').trim().slice(0, 30)) })`).catch(() => null)
    if (st) {
      if (st.done) return { ms: Date.now() - t0 }
      if (st.text !== lastText) { lastText = st.text; log('+' + (Date.now() - t0) + ' ms: ' + st.text + ' | ' + st.buttons.join(' / ')) }
    }
    await sleep(500)
  }
  throw new Error('the import did not finish: ' + lastText)
}

/** Reloads; the app reopens the last open character itself, so the library is used only when it shows the home screen instead. */
export async function reloadToCharacter(c, name) {
  await c.send('Page.reload')
  await reachHome(c, { homeSelector: '[data-part=home-landing], [data-part=chat-messages]' })
  if (!(await c.ev(`!!document.querySelector('[data-part=chat-messages]')`))) {
    await openLibrary(c)
    await findByName(c, name)
    await clickByText(c, '[data-part=character-name-row]', name)
  }
  await waitFor(c, `!!document.querySelector('[data-part=chat-messages]')`, { timeoutMs: 60000 })
}

/** Maps the library to what to look for: names, and per character the first 24 characters of every message. */
async function expectationsOf(params) {
  const lib = await import(pathToFileURL(path.join(REPO_ROOT, 'Agents', 'Tools', 'save-gen', 'c806-library.mjs')).href)
  const p = lib.normalizeParams(params)
  const out = []
  for (let i = 0; i < p.characters; i++) {
    const ch = lib.buildCharacter(p, i)
    out.push({ index: i, name: ch.name, chaId: ch.chaId, chats: ch.chats.length, markers: ch.chats.flatMap(chat => chat.message.map(m => String(m.data).slice(0, 24))) })
  }
  return out
}

/** Controls: damage a copy of the tree in save/ the way a G1 control needs. */
function mutateSave(saveDir, kind, census, chaId) {
  const hexOf = (key) => Buffer.from(key, 'utf8').toString('hex')
  const rows = census.census.characters.rows
  if (kind === 'shard') {
    // a unit's type is the sixth byte of its frame; the first shard unit has it 3
    const name = fs.readdirSync(saveDir).find(entry => !entry.startsWith('__') && fs.readFileSync(path.join(saveDir, entry))[5] === 3)
    const file = path.join(saveDir, name)
    const bytes = fs.readFileSync(file)
    bytes[Math.floor(bytes.length / 2)] ^= 0xFF
    fs.writeFileSync(file, bytes)
    return { mutated: Buffer.from(name, 'hex').toString('utf8'), kind }
  }
  if (kind === 'chunk') {
    // a chat chunk of the character the run opens (the last one)
    const target = rows.find(r => r.chaId === chaId).keys.find(k => k.type === 'chatChunk')
    fs.rmSync(path.join(saveDir, hexOf(target.key)))
    return { mutated: target.key, kind }
  }
  if (kind === 'utf16') {
    let renamed = 0
    for (const name of fs.readdirSync(saveDir)) {
      if (name.startsWith('__')) continue
      const key = Buffer.from(name, 'hex').toString('utf8')
      fs.renameSync(path.join(saveDir, name), path.join(saveDir, Buffer.from(key, 'utf16le').toString('hex')))
      renamed++
    }
    return { renamed, kind }
  }
  throw new Error('unknown control ' + kind)
}
//#endregion

/**
 * The G1 smoke on one tree: boot, names, open, edit, reload. Returns a record of what happened; it decides nothing beyond
 * the booleans it names.
 */
export async function smoke({ tag, treeDir, dist, paramsFile, censusFile, control = null, edit = false, label = tag }) {
  const result = { label, tag, control, steps: {} }
  const params = JSON.parse(fs.readFileSync(paramsFile, 'utf8')).params
  const census = censusFile ? JSON.parse(fs.readFileSync(censusFile, 'utf8')) : null
  const expected = await expectationsOf(params)
  result.distIndexSha256 = prepareDist(tag, dist)
  const d = dirsOf(tag)
  result.restore = restoreTree(tag, treeDir)
  result.pristineCommitHash = commitKeyHash(treeDir)
  if (control) result.mutation = mutateSave(d.save, control, census, expected[expected.length - 1].chaId)
  const gitText = (...args) => { try { return execFileSync('git', ['-C', REPO_ROOT, ...args], { encoding: 'utf8' }).trim() } catch (e) { return 'git failed: ' + e.message } }
  result.provenance = { head: gitText('rev-parse', 'HEAD'), statusToolsAndSrc: gitText('status', '--short', '--', 'Agents/Tools', 'src').split('\n').filter(Boolean) }
  const runDir = scratchPath(C806_ROOT, 'runs', 'stage1', tag + '-' + Date.now())
  fs.mkdirSync(runDir, { recursive: true })
  result.runDir = runDir
  // the server and Chrome start inside the try, so the finally ends whichever of them started
  let server = null
  let h = null
  try {
    server = await startServer({ tag })
    h = await launchChrome({ runDir, profileName: tag + '-' + Date.now() })
    result.pids = { server: server.pid, chrome: h.chrome, launcher: h.launcher }
    // phase 1: the boot meters stay off
    const { c, state } = await attach(h, { switches: {} })
    const nav0 = Date.now()
    await c.send('Page.navigate', { url: server.baseUrl + '/' })
    try {
      const home = await reachHome(c, { timeoutMs: control ? 45000 : 120000 })
      result.steps.boot = { reachedHome: true, ms: home.ms, prompts: home.prompts, navigations: state.navigations, snapshot: await snapshotOf(c) }
    } catch (e) {
      result.steps.boot = { reachedHome: false, navigations: state.navigations, why: String(e.message).slice(0, 600) }
      return result
    }
    await openLibrary(c)
    const names = expected.length <= 50 ? expected.map(e => e.name) : [expected[0].name, expected[expected.length - 1].name]
    const found = {}
    for (const name of names) found[name] = await findByName(c, name)
    const missing = await findByName(c, 'Synthetic nonexistent-name', 8000)
    const noMatch = await c.ev(`!!document.querySelector('[data-part=library-no-match]')`)
    result.steps.search = { found, allFound: Object.values(found).every(Boolean), nonexistentShowsNoMatch: !missing && noMatch }
    if (!result.steps.search.allFound) return result
    // open the last character; the reads of that window are its leaves
    const last = expected[expected.length - 1]
    await findByName(c, last.name)
    const beforeOpen = readReqlog(d.reqlog).length
    const openAt = Date.now()
    await clickByText(c, '[data-part=character-name-row]', last.name)
    try {
      await waitFor(c, `!!document.querySelector('[data-part=chat-messages]')`, { timeoutMs: control ? 20000 : 60000 })
    } catch (e) {
      result.steps.open = { character: last.name, chatShown: false, snapshot: await snapshotOf(c) }
      return result
    }
    const markerShown = await waitFor(c, `(() => { const t = document.body.innerText; return ${JSON.stringify(last.markers.slice(0, 200))}.some(m => t.includes(m)) })()`, { timeoutMs: 30000 }).catch(() => false)
    await sleep(3000)
    const openLines = readReqlog(d.reqlog).slice(beforeOpen)
    const readKeys = readUnitKeys(openLines)
    const row = census ? census.census.characters.rows.find(r => r.chaId === last.chaId) : null
    const leafKeys = row?.keys ? new Set(row.keys.filter(k => k.type !== 'shard').map(k => k.key)) : null
    result.steps.open = {
      character: last.name, markerShown: !!markerShown, readUnitKeyCount: readKeys.size, openMs: Date.now() - openAt,
      censusLeafCount: leafKeys ? leafKeys.size : null,
      readInsideLeaves: leafKeys ? [...readKeys].filter(k => leafKeys.has(k)).length : null,
      readOutsideLeaves: leafKeys ? [...readKeys].filter(k => !leafKeys.has(k)) : null,
      leavesNotRead: leafKeys ? [...leafKeys].filter(k => !readKeys.has(k)).length : null,
      requests: openLines.length,
    }
    if (edit) {
      await c.ev(`localStorage.setItem('risu-measure-savepass', 'on')`)
      await reloadToCharacter(c, last.name)
      await sleep(4000)
      const before = await sidebarButtons(c)
      const commitsBefore = readReqlog(d.reqlog).filter(l => l.method === 'POST' && l.classes['store2-commit']).length
      const editAt = Date.now()
      if (!(await clickByText(c, 'button', 'New Chat'))) throw new Error('no New Chat button')
      let wrote = null
      const w0 = Date.now()
      while (Date.now() - w0 < 30000) {
        const commits = readReqlog(d.reqlog).filter(l => l.method === 'POST' && l.classes['store2-commit'])
        if (commits.length > commitsBefore) { wrote = commits[commits.length - 1]; break }
        await sleep(250)
      }
      const allCommits = readReqlog(d.reqlog).filter(l => l.method === 'POST' && l.classes['store2-commit']).map(l => ({ ifMatch: l.ifMatch, status: l.status }))
      result.steps.edit = {
        sidebarBefore: before, editCommit: wrote ? { ifMatch: wrote.ifMatch, status: wrote.status, afterMs: Math.round(wrote.t1 - editAt) } : null,
        allCommitWritesSinceServerStart: allCommits, meterType: await c.ev(`typeof __risuSavePassMeter`),
      }
      await reloadToCharacter(c, last.name)
      await sleep(3000)
      const after = await sidebarButtons(c)
      result.steps.edit.sidebarAfterReload = after
      result.steps.edit.persistedAfterReload = after.length === before.length + 1 && after.includes('New Chat 3') && !before.includes('New Chat 3')
    }
    // a 429 means the server's storage limiter shaped the run: such a boot is limiter-bound, not boot cost
    result.limited429 = readReqlog(d.reqlog).filter(l => l.limited).length
    result.proxyRefusals = fs.existsSync(path.join(runDir, 'proxy-refusals.jsonl')) ? fs.readFileSync(path.join(runDir, 'proxy-refusals.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0
    return result
  } finally {
    if (h) result.closed = await closeChrome(h)
    if (server) await server.stop()
    result.commitHashAfter = commitKeyHash(d.save)
    fs.writeFileSync(path.join(runDir, 'smoke.json'), JSON.stringify(result, null, 2))
  }
}

const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null }
const has = (k) => process.argv.includes(k)

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const cmd = process.argv[2]
  if (cmd === 'probe') {
    // probe --tag <t> --dist <dir> [--tree <dir>] [--seconds n]: boot a tree, answer the password prompt, print snapshots.
    const tag = arg('--tag')
    prepareDist(tag, arg('--dist'))
    if (arg('--tree')) restoreTree(tag, arg('--tree'))
    const runDir = scratchPath(C806_ROOT, 'runs', 'stage1', tag + '-probe-' + Date.now())
    let server = null
    let h = null
    try {
      server = await startServer({ tag })
      h = await launchChrome({ runDir, profileName: tag + '-probe-' + Date.now() })
      const { c, state } = await attach(h)
      await c.send('Page.navigate', { url: server.baseUrl + '/' })
      const seconds = Number(arg('--seconds') ?? '40')
      let passwordDone = false
      for (let s = 0; s < seconds; s += 2) {
        await sleep(2000)
        const snap = await snapshotOf(c)
        console.log(JSON.stringify({ t: s + 2, navigations: state.navigations, ...snap }))
        if (snap.alertInput && !passwordDone) { passwordDone = true; await fillPasswordPrompt(c) }
      }
    } finally {
      if (h) console.log(JSON.stringify(await closeChrome(h)))
      if (server) await server.stop()
    }
  } else if (cmd === 'smoke') {
    // smoke --tag <t> --tree <pristine dir> --dist <dir> --tree-json <tree.json> [--census <census.json>] [--control shard|chunk|utf16] [--edit]
    const r = await smoke({ tag: arg('--tag'), treeDir: arg('--tree'), dist: arg('--dist'), paramsFile: arg('--tree-json'), censusFile: arg('--census'), control: arg('--control'), edit: has('--edit') })
    console.log(JSON.stringify(r, null, 2))
  } else {
    console.error('commands: probe, smoke')
    process.exit(2)
  }
}

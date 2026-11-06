// Chat-shell CDP harness library: CDP connection, phone emulation, input helpers, output and Chrome launch rules.
// Invariants:
// - Importing this module neither connects nor writes anything.
// - Every output goes through outDir(), which refuses a path inside the checkout or the tool folder, so a run never
//   dirties the repository. The refusal is lexical: a junction or an 8.3 short name that leads into the checkout is not seen.
// - ws comes from the checkout's own node_modules, so the tool follows the checkout it lives in.
// - hostRules() is the single source of the host blocking; launch-chrome passes it as one argument element, with no shell.
// Env overrides: CHATSHELL_CDP_DIR / CHATSHELL_REPO_ROOT (point the tool at another copy of the tool folder or another checkout), HARNESS_OUT, HARNESS_CDP, HARNESS_APP.
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const TOOL_DIR = process.env.CHATSHELL_CDP_DIR ? path.resolve(process.env.CHATSHELL_CDP_DIR) : path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = process.env.CHATSHELL_REPO_ROOT ? path.resolve(process.env.CHATSHELL_REPO_ROOT) : path.resolve(TOOL_DIR, '..', '..', '..')
const require = createRequire(path.join(REPO_ROOT, 'package.json'))
export const wsPath = require.resolve('ws')
const WebSocket = require('ws')
export const sleep = (ms) => new Promise(r => setTimeout(r, ms))

const DEFAULT_PORT = 9470
export const cdpPort = () => Number(process.env.HARNESS_CDP || DEFAULT_PORT)
export const APP = process.env.HARNESS_APP || 'http://127.0.0.1:6293/'

const norm = (p) => process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p)
function isInside(p, root) {
  const a = norm(p), b = norm(root)
  return a === b || a.startsWith(b.endsWith(path.sep) ? b : b + path.sep)
}
function assertOutsideRepo(p, what) {
  if (isInside(p, REPO_ROOT) || isInside(p, TOOL_DIR)) throw new Error(what + ' must be outside the checkout and the tool folder: ' + path.resolve(p))
}

// Output directory: the argument, else HARNESS_OUT, else a folder under the OS temp dir. Created on demand.
export function outDir(req) {
  const abs = path.resolve(req || process.env.HARNESS_OUT || path.join(os.tmpdir(), 'chatshell-cdp', 'out'))
  assertOutsideRepo(abs, 'out dir')
  fs.mkdirSync(abs, { recursive: true })
  return abs
}

// Hosts a harness page must never reach. mock.test is the local mock endpoint; the others are real services.
const BLOCKED_HOSTS = ['*.risuai.xyz', 'risuai.xyz', '*.risuai.net', 'risuai.net', 'discord.com', '*.discord.com', 'discord.gg', '*.discordapp.com']
export const hostRules = () => ['MAP mock.test 127.0.0.1', ...BLOCKED_HOSTS.map(h => 'MAP ' + h + ' ~NOTFOUND')].join(', ')

// Chrome arguments for a harness browser. The profile must be outside the checkout; it is not created here.
export function chromeArgs({ port = cdpPort(), profile } = {}) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('bad debugging port: ' + port)
  const prof = path.resolve(profile || path.join(os.tmpdir(), 'chatshell-cdp', 'profile'))
  assertOutsideRepo(prof, 'profile dir')
  return [`--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, `--host-resolver-rules=${hostRules()}`, '--no-first-run', '--no-default-browser-check']
}

export async function connect({ port = cdpPort() } = {}) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const pages = list.filter(x => x.type === 'page')
  if (pages.length !== 1) throw new Error('pages=' + pages.length)
  const ws = new WebSocket(pages[0].webSocketDebuggerUrl, { perMessageDeflate: false })
  await new Promise(r => ws.on('open', r))
  let id = 0; const pend = new Map(); const listeners = []
  ws.on('message', d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } else if (m.method) listeners.forEach(l => l(m)) })
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)); ws.send(JSON.stringify({ id: i, method, params })) })
  const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 500)); return r.result.value }
  const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const file = path.join(outDir(), name + '.png'); fs.writeFileSync(file, Buffer.from(r.data, 'base64')); return file }
  const touch = async (type, pts) => send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, i) => ({ x: p[0], y: p[1], id: i + 1 })) })
  const tap = async (x, y) => { await touch('touchStart', [[x, y]]); await sleep(60); await touch('touchEnd', []) }
  const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' || type === 'mouseMoved' ? 0 : 1, clickCount: 1, ...extra })
  const on = (l) => listeners.push(l)
  await send('Page.enable'); await send('Runtime.enable')
  return { ws, send, ev, shot, touch, tap, mouse, on }
}

// 360x740 CSS px, DPR 2.8125 (Note 9 class), touch emulation on.
export async function phoneMode(c) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: 360, height: 740, deviceScaleFactor: 2.8125, mobile: true })
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  await c.send('Emulation.setEmitTouchEventsForMouse', { enabled: false })
}
export async function desktopMode(c) {
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: false })
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
}

export async function touchDrag(c, x, y0, dy, { step = 20, dt = 16 } = {}) {
  // dy > 0: finger moves down (reveals older content).
  const n = Math.max(1, Math.round(Math.abs(dy) / step)); const s = dy / n
  await c.touch('touchStart', [[x, y0]])
  for (let i = 1; i <= n; i++) { await c.touch('touchMove', [[x, y0 + s * i]]); await sleep(dt) }
  await c.touch('touchEnd', [])
}
// Fling through Chromium's own gesture synthesiser (momentum scroll). yDistance > 0 scrolls the page content down (newer).
export async function fling(c, x, y, yDistance, speed = 3000) {
  await c.send('Input.synthesizeScrollGesture', { x, y, yDistance, speed, gestureSourceType: 'touch', preventFling: false })
}

// Reload the app and open a character's chat through the sidebar (hamburger, grid, character icon). Coordinates belong to the
// prepared fixture profile. slotY: sidebar character icon centre (CSS px); slot 1 = 89 (default character), slot 2 = 157 (H15 Alt Greetings).
export async function openChat(c, slotY = 89) {
  await c.send('Page.navigate', { url: APP }); await sleep(12000)
  await c.tap(22, 34); await sleep(1000)
  await c.tap(40, 275); await sleep(1200)
  await c.tap(40, slotY); await sleep(3500)
  await c.tap(350, 300); await sleep(1000)
  const inT = await c.ev("!!document.elementFromPoint(200, 300)?.closest('[data-part=chat-transcript]')")
  if (!inT) throw new Error('sidebar still open')
  const ok = await c.ev(`!!document.querySelector('[data-part=chat-transcript]')`)
  if (!ok) throw new Error('chat not opened')
}
